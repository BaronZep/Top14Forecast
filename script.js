let standingsData = [];
let calendarData = [];
let currentRoundIdx = 0;
let userPredictions = {};
let monteCarloResults = null;
let monteCarloResultsStale = false;
let standingsSyncWarning = null;
let playoffPredictions = {
    barrage1: null,
    barrage2: null,
    demi1: null,
    demi2: null,
    finale: null
};
let mcLoading = false;

const SYMBOL_TO_CODE = { '-': 0, '0': 1, '1': 2, '2': 3, '4': 4, '5': 5 };
const CODE_TO_POINTS = { 0: '', 1: 0, 2: 1, 3: 2, 4: 4, 5: 5 };
const BITS_PER_TEAM_PREDICTION = 3;
const BITS_PER_MATCH_PREDICTION = BITS_PER_TEAM_PREDICTION * 2;
const PREDICTION_KEY_PREFIX = 'T14:';

const SCORE_OPTIONS = [0, 1, 2, 4, 5];
const SCORE_COMPATIBILITY = {
    0: [4, 5],
    1: [4, 5],
    2: [2],
    4: [0, 1],
    5: [0, 1]
};

function normalizeTeamName(name) {
    return String(name ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function isRoundEntry(entry) {
    return Array.isArray(entry?.matches);
}

function isDisplayableEntry(entry) {
    return !!entry?.interlude || isRoundEntry(entry);
}

function getDisplayableRoundIndices() {
    return calendarData
        .map((entry, idx) => ({ entry, idx }))
        .filter(({ entry }) => isDisplayableEntry(entry))
        .map(({ idx }) => idx);
}

function getCurrentDisplayableIndices() {
    return getDisplayableRoundIndices();
}

function getTeamAdjustments() {
    const adjustmentEntry = calendarData.find(entry => entry?.type === 'adjustments');
    return adjustmentEntry?.teamAdjustments || {};
}

function computeStandingsFromCalendar() {
    const derived = {};
    const adjustments = getTeamAdjustments();

    standingsData.forEach(team => {
        derived[team.name] = 0;
    });

    calendarData.forEach(entry => {
        if (!isRoundEntry(entry)) return;

        entry.matches.forEach(match => {
            if (match.homePts === null || match.awayPts === null) return;

            const homeTeam = findTeamByName(standingsData, match.homeTeam);
            const awayTeam = findTeamByName(standingsData, match.awayTeam);

            if (homeTeam) {
                derived[homeTeam.name] = (derived[homeTeam.name] || 0) + Number(match.homePts || 0);
            }

            if (awayTeam) {
                derived[awayTeam.name] = (derived[awayTeam.name] || 0) + Number(match.awayPts || 0);
            }
        });
    });

    Object.entries(adjustments).forEach(([teamName, delta]) => {
        const team = findTeamByName(standingsData, teamName);
        if (team) {
            derived[team.name] = (derived[team.name] || 0) + Number(delta || 0);
        }
    });

    return derived;
}

function updateStandingsSyncWarning() {
    const derived = computeStandingsFromCalendar();
    const mismatches = [];

    standingsData.forEach(team => {
        const expected = derived[team.name] || 0;
        const actual = Number(team.points) || 0;

        if (actual !== expected) {
            mismatches.push({
                name: team.name,
                actual,
                expected
            });
        }
    });

    if (!mismatches.length) {
        standingsSyncWarning = null;
        return;
    }

    const preview = mismatches
        .slice(0, 3)
        .map(team => `${team.name} (${team.actual} vs ${team.expected})`)
        .join(', ');

    standingsSyncWarning =
        `Classement incohérent avec calendar.json — mettre à jour standings.json` +
        `${preview ? ` : ${preview}` : ''}` +
        `${mismatches.length > 3 ? '…' : ''}`;
}

async function loadData() {
    try {
        const [sRes, cRes] = await Promise.all([
            fetch('standings.json'),
            fetch('calendar.json')
        ]);

        standingsData = await sRes.json();
        calendarData = await cRes.json();

        const displayableIndices = getDisplayableRoundIndices();

        const firstPendingIdx = displayableIndices.find(idx => {
            const entry = calendarData[idx];
            return isRoundEntry(entry) && entry.matches.some(match => match.homePts === null);
        });

        if (firstPendingIdx !== undefined) {
            currentRoundIdx = firstPendingIdx;
        } else if (displayableIndices.length > 0) {
            currentRoundIdx = displayableIndices[displayableIndices.length - 1];
        } else {
            currentRoundIdx = 0;
        }

        updateStandingsSyncWarning();
        initUI();
    } catch (e) {
        console.error('Utilisez Live Server !', e);
    }
}

function initUI() {
    const themeSlider = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme(dark) {
        document.body.classList.toggle('dark-mode', dark);
        document.body.classList.toggle('light-mode', !dark);
        themeSlider.setAttribute('aria-checked', dark ? 'true' : 'false');
    }

    applyTheme(prefersDark.matches);

    prefersDark.addEventListener('change', e => {
        if (!themeSlider.dataset.manualOverride) {
            applyTheme(e.matches);
        }
    });

    themeSlider.addEventListener('click', () => {
        themeSlider.dataset.manualOverride = '1';
        applyTheme(themeSlider.getAttribute('aria-checked') !== 'true');
    });

    themeSlider.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            themeSlider.dataset.manualOverride = '1';
            applyTheme(themeSlider.getAttribute('aria-checked') !== 'true');
        }
    });

    document.getElementById('prev-btn').onclick = () => changeRound(-1);
    document.getElementById('next-btn').onclick = () => changeRound(1);

    const loadBtn = document.getElementById('prediction-hex-load');
    const copyBtn = document.getElementById('prediction-hex-copy');
    const input = document.getElementById('prediction-hex-input');

    if (loadBtn) loadBtn.onclick = handlePredictionWordLoad;
    if (copyBtn) copyBtn.onclick = copyPredictionWord;
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handlePredictionWordLoad();
            }
        });

        input.addEventListener('input', () => {
            if (input.classList.contains('is-error')) {
                clearPredictionKeyInputError();
            }
        });
    }

    updateMonteCarloButtonLabel();
    updateDisplay();
}

function changeRound(step) {
    const displayableIndices = getCurrentDisplayableIndices();
    const currentPos = displayableIndices.indexOf(currentRoundIdx);

    if (currentPos === -1) return;

    const newPos = currentPos + step;
    if (newPos >= 0 && newPos < displayableIndices.length) {
        currentRoundIdx = displayableIndices[newPos];
        updateDisplay();
    }
}

function updateDisplay() {
    const projectedStandings = getProjectedStandings();
    sanitizePlayoffPredictions(projectedStandings);
    const playoffBracket = getPlayoffBracket(projectedStandings);

    renderMatches();
    renderPlayoffs(playoffBracket);
    renderMonteCarloResults();
    refreshPredictionWord();

    const currentEntry = calendarData[currentRoundIdx];
    const label = document.getElementById('round-label');

    if (!currentEntry) {
        label.innerText = '';
        return;
    }

    label.innerText = currentEntry.interlude
        ? currentEntry.title
        : `Journée ${currentEntry.round}`;
}

function getPredictionKey(rIdx, mIdx, teamName) {
    return `R${rIdx}|M${mIdx}|${teamName}`;
}

function getPredictableMatchRefs() {
    const refs = [];

    calendarData.forEach((entry, rIdx) => {
        if (!isRoundEntry(entry)) return;

        entry.matches.forEach((match, mIdx) => {
            if (match.homePts !== null || match.awayPts !== null) return;
            refs.push({ rIdx, mIdx, match });
        });
    });

    return refs;
}

function getPredictionSymbol(value) {
    if (value === undefined || value === null || value === '') return '-';
    return String(value);
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBitsToBase64Url(bitString) {
    if (!bitString) return '';

    const paddedBits = bitString.padEnd(Math.ceil(bitString.length / 6) * 6, '0');
    let out = '';

    for (let i = 0; i < paddedBits.length; i += 6) {
        out += BASE64URL_ALPHABET[parseInt(paddedBits.slice(i, i + 6), 2)];
    }

    return out;
}

function decodeBase64UrlToBits(text) {
    let bits = '';

    for (const char of text) {
        const digit = BASE64URL_ALPHABET.indexOf(char);
        if (digit === -1) {
            return null;
        }

        bits += digit.toString(2).padStart(6, '0');
    }

    return bits;
}

function encodePredictionKey() {
    const chunks = [];

    getPredictableMatchRefs().forEach(({ rIdx, mIdx, match }) => {
        [match.homeTeam, match.awayTeam].forEach(teamName => {
            const key = getPredictionKey(rIdx, mIdx, teamName);
            const symbol = getPredictionSymbol(userPredictions[key]);
            const code = SYMBOL_TO_CODE[symbol];
            chunks.push(code.toString(2).padStart(BITS_PER_TEAM_PREDICTION, '0'));
        });
    });

    while (chunks.length > 0 && chunks[chunks.length - 1] === '000') {
        chunks.pop();
    }

    const payload = encodeBitsToBase64Url(chunks.join(''));
    return payload ? `${PREDICTION_KEY_PREFIX}${payload}` : '';
}

function setPredictionKeyInputError(message) {
    const input = document.getElementById('prediction-hex-input');
    if (!input) return;

    input.classList.add('is-error');
    input.value = '';
    input.placeholder = message;
}

function clearPredictionKeyInputError() {
    const input = document.getElementById('prediction-hex-input');
    if (!input) return;

    input.classList.remove('is-error');
    input.placeholder = 'Charger une clé';
}

function applyPredictionWord(rawWord) {
    const compactWord = String(rawWord ?? '').trim().replace(/\s+/g, '');

    if (!compactWord) {
        clearPredictionKeyInputError();
        return;
    }

    if (!compactWord.startsWith(PREDICTION_KEY_PREFIX)) {
        setPredictionKeyInputError(`Clé invalide`);
        return;
    }

    const payload = compactWord.slice(PREDICTION_KEY_PREFIX.length);
    if (!payload) {
        setPredictionKeyInputError('Clé invalide');
        return;
    }

    const bitString = decodeBase64UrlToBits(payload);
    if (bitString === null) {
        setPredictionKeyInputError('Clé invalide');
        return;
    }

    const predictableMatches = getPredictableMatchRefs();
    const totalSlots = predictableMatches.length * 2;
    const maxBits = totalSlots * BITS_PER_TEAM_PREDICTION;

    if (bitString.length > maxBits) {
        setPredictionKeyInputError("Plus assez de matchs à pronostiquer pour cette clé");
        return;
    }

    predictableMatches.forEach(({ rIdx, mIdx, match }, matchIdx) => {
        [match.homeTeam, match.awayTeam].forEach((teamName, teamOffset) => {
            const slotIdx = matchIdx * 2 + teamOffset;
            const start = slotIdx * BITS_PER_TEAM_PREDICTION;
            const chunk = bitString.slice(start, start + BITS_PER_TEAM_PREDICTION);
            const key = getPredictionKey(rIdx, mIdx, teamName);

            if (chunk.length < BITS_PER_TEAM_PREDICTION) {
                delete userPredictions[key];
                return;
            }

            const code = parseInt(chunk, 2);
            if (!(code in CODE_TO_POINTS)) {
                delete userPredictions[key];
                return;
            }

            const value = CODE_TO_POINTS[code];
            if (value === '' || value === undefined) {
                delete userPredictions[key];
            } else {
                userPredictions[key] = value;
            }
        });
    });

    clearPredictionKeyInputError();

    const projectedStandings = getProjectedStandings();
    sanitizePlayoffPredictions(projectedStandings);
    monteCarloResultsStale = true;
    renderMatches();
    renderPlayoffs(getPlayoffBracket(projectedStandings));
    renderMonteCarloResults();
    refreshPredictionWord();
}

function handlePredictionWordLoad() {
    const input = document.getElementById('prediction-hex-input');
    if (!input) return;
    applyPredictionWord(input.value);
}

function refreshPredictionWord() {
    const output = document.getElementById('prediction-hex-output');
    if (!output) return;

    output.value = encodePredictionKey();
}

function copyPredictionWord() {
    const output = document.getElementById('prediction-hex-output');
    if (!output) return;

    output.select();
    output.setSelectionRange(0, output.value.length);
    navigator.clipboard.writeText(output.value).catch(() => {});
}

function findTeamByName(teams, teamName) {
    const target = normalizeTeamName(teamName);
    return teams.find(team => normalizeTeamName(team.name) === target) || null;
}

function getProjectedDeltaMap() {
    const deltaMap = {};

    standingsData.forEach(team => {
        deltaMap[team.name] = 0;
    });

    calendarData.forEach((round, rIdx) => {
        if (!isRoundEntry(round)) return;

        round.matches.forEach((match, mIdx) => {
            if (match.homePts !== null && match.awayPts !== null) {
                return;
            }

            const prediction = getMatchPrediction(rIdx, mIdx);
            if (!prediction) {
                return;
            }

            const homeTeam = findTeamByName(standingsData, match.homeTeam);
            const awayTeam = findTeamByName(standingsData, match.awayTeam);

            if (homeTeam) {
                deltaMap[homeTeam.name] += prediction.homePts;
            }

            if (awayTeam) {
                deltaMap[awayTeam.name] += prediction.awayPts;
            }
        });
    });

    return deltaMap;
}

function getMatchPrediction(rIdx, mIdx) {
    const round = calendarData[rIdx];
    if (!isRoundEntry(round)) return null;

    const match = round.matches[mIdx];
    if (!match) return null;

    const homeKey = getPredictionKey(rIdx, mIdx, match.homeTeam);
    const awayKey = getPredictionKey(rIdx, mIdx, match.awayTeam);

    const homeVal = userPredictions[homeKey];
    const awayVal = userPredictions[awayKey];

    if (homeVal === undefined || awayVal === undefined || homeVal === '' || awayVal === '') {
        return null;
    }

    return {
        homePts: parseInt(homeVal, 10),
        awayPts: parseInt(awayVal, 10)
    };
}

function getAllowedScores(opponentScore) {
    if (opponentScore === undefined || opponentScore === null || opponentScore === '') {
        return SCORE_OPTIONS;
    }

    return SCORE_COMPATIBILITY[parseInt(opponentScore, 10)] || SCORE_OPTIONS;
}

function getProjectedStandings() {
    const live = standingsData.map(team => ({ ...team }));

    calendarData.forEach((round, rIdx) => {
        if (!isRoundEntry(round)) return;

        round.matches.forEach((match, mIdx) => {
            if (match.homePts !== null && match.awayPts !== null) {
                return;
            }

            const prediction = getMatchPrediction(rIdx, mIdx);
            if (!prediction) {
                return;
            }

            const homeTeam = findTeamByName(live, match.homeTeam);
            const awayTeam = findTeamByName(live, match.awayTeam);

            if (homeTeam) {
                homeTeam.points += prediction.homePts;
            }

            if (awayTeam) {
                awayTeam.points += prediction.awayPts;
            }
        });
    });

    live.sort((a, b) => {
        if (b.points !== a.points) {
            return b.points - a.points;
        }

        const h2h = calculateHeadToHead(a.name, b.name);
        if (h2h.ptsA !== h2h.ptsB) {
            return h2h.ptsB - h2h.ptsA;
        }

        return normalizeTeamName(a.name).localeCompare(normalizeTeamName(b.name));
    });

    return live;
}

function calculateHeadToHead(teamA, teamB) {
    const normA = normalizeTeamName(teamA);
    const normB = normalizeTeamName(teamB);
    let ptsA = 0;
    let ptsB = 0;

    calendarData.forEach((round, rIdx) => {
        if (!isRoundEntry(round)) return;

        round.matches.forEach((match, mIdx) => {
            const matchHome = normalizeTeamName(match.homeTeam);
            const matchAway = normalizeTeamName(match.awayTeam);
            const isHeadToHead =
                (matchHome === normA && matchAway === normB) ||
                (matchHome === normB && matchAway === normA);

            if (!isHeadToHead) {
                return;
            }

            let homePts = match.homePts;
            let awayPts = match.awayPts;

            if (homePts === null || awayPts === null) {
                const prediction = getMatchPrediction(rIdx, mIdx);
                if (!prediction) {
                    return;
                }

                homePts = prediction.homePts;
                awayPts = prediction.awayPts;
            }

            if (matchHome === normA) {
                ptsA += homePts;
                ptsB += awayPts;
            } else {
                ptsA += awayPts;
                ptsB += homePts;
            }
        });
    });

    return { ptsA, ptsB };
}

function getPlayoffBracket(standings = getProjectedStandings()) {
    const top6 = standings.slice(0, 6);

    if (top6.length < 6) {
        return null;
    }

    const seeds = {
        rank1: top6[0]?.name ?? null,
        rank2: top6[1]?.name ?? null,
        rank3: top6[2]?.name ?? null,
        rank4: top6[3]?.name ?? null,
        rank5: top6[4]?.name ?? null,
        rank6: top6[5]?.name ?? null
    };

    const barrage1Participants = [seeds.rank4, seeds.rank5].filter(Boolean);
    const barrage2Participants = [seeds.rank3, seeds.rank6].filter(Boolean);

    const barrage1Winner = barrage1Participants.includes(playoffPredictions.barrage1) ? playoffPredictions.barrage1 : null;
    const barrage2Winner = barrage2Participants.includes(playoffPredictions.barrage2) ? playoffPredictions.barrage2 : null;

    const demi1Participants = [seeds.rank1, barrage1Winner].filter(Boolean);
    const demi2Participants = [seeds.rank2, barrage2Winner].filter(Boolean);

    const demi1Winner = demi1Participants.includes(playoffPredictions.demi1) ? playoffPredictions.demi1 : null;
    const demi2Winner = demi2Participants.includes(playoffPredictions.demi2) ? playoffPredictions.demi2 : null;

    const finaleParticipants = [demi1Winner, demi2Winner].filter(Boolean);
    const finaleWinner = finaleParticipants.includes(playoffPredictions.finale) ? playoffPredictions.finale : null;

    return {
        barrage1: { id: 'barrage1', label: 'Barrage 1', homeTeam: seeds.rank4, awayTeam: seeds.rank5, homeSeed: '#4', awaySeed: '#5', winner: barrage1Winner },
        barrage2: { id: 'barrage2', label: 'Barrage 2', homeTeam: seeds.rank3, awayTeam: seeds.rank6, homeSeed: '#3', awaySeed: '#6', winner: barrage2Winner },
        demi1: { id: 'demi1', label: 'Demi-finale 1', homeTeam: seeds.rank1, awayTeam: barrage1Winner, homeSeed: '#1', awaySeed: barrage1Winner ? (barrage1Winner === seeds.rank4 ? '#4' : '#5') : null, winner: demi1Winner },
        demi2: { id: 'demi2', label: 'Demi-finale 2', homeTeam: seeds.rank2, awayTeam: barrage2Winner, homeSeed: '#2', awaySeed: barrage2Winner ? (barrage2Winner === seeds.rank3 ? '#3' : '#6') : null, winner: demi2Winner },
        finale: { id: 'finale', label: 'Finale', homeTeam: demi1Winner, awayTeam: demi2Winner, homeSeed: demi1Winner ? (demi1Winner === seeds.rank1 ? '#1' : (demi1Winner === seeds.rank4 ? '#4' : '#5')) : null, awaySeed: demi2Winner ? (demi2Winner === seeds.rank2 ? '#2' : (demi2Winner === seeds.rank3 ? '#3' : '#6')) : null, winner: finaleWinner }
    };
}

function sanitizePlayoffPredictions(standings = getProjectedStandings()) {
    const bracket = getPlayoffBracket(standings);
    if (!bracket) {
        return;
    }

    const isValidWinner = (winner, homeTeam, awayTeam) => winner && [homeTeam, awayTeam].includes(winner);

    if (!isValidWinner(playoffPredictions.barrage1, bracket.barrage1.homeTeam, bracket.barrage1.awayTeam)) {
        playoffPredictions.barrage1 = null;
    }

    if (!isValidWinner(playoffPredictions.barrage2, bracket.barrage2.homeTeam, bracket.barrage2.awayTeam)) {
        playoffPredictions.barrage2 = null;
    }

    const updatedBracket = getPlayoffBracket(standings);

    if (!isValidWinner(playoffPredictions.demi1, updatedBracket.demi1.homeTeam, updatedBracket.demi1.awayTeam)) {
        playoffPredictions.demi1 = null;
    }

    if (!isValidWinner(playoffPredictions.demi2, updatedBracket.demi2.homeTeam, updatedBracket.demi2.awayTeam)) {
        playoffPredictions.demi2 = null;
    }

    const finalBracket = getPlayoffBracket(standings);

    if (!isValidWinner(playoffPredictions.finale, finalBracket.finale.homeTeam, finalBracket.finale.awayTeam)) {
        playoffPredictions.finale = null;
    }
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderPlayoffTeam(match, teamName, seedLabel = null) {
    const isEmpty = !teamName;
    const isWinner = !!teamName && match.winner === teamName;
    const classes = ['playoff-team'];

    if (isWinner) classes.push('is-winner');
    if (isEmpty) classes.push('is-empty');

    const onclick = isEmpty ? '' : `onclick="handlePlayoffPick('${match.id}', '${escapeAttr(teamName)}')"`;
    const seed = seedLabel ? `<span class="playoff-seed">${seedLabel}</span>` : '';
    const content = teamName ? `<span class="playoff-team-line">${seed}<span class="playoff-team-name">${teamName}</span></span>` : 'À déterminer';

    return `<button class="${classes.join(' ')}" ${isEmpty ? 'disabled' : ''} ${onclick}>${content}</button>`;
}

function renderPlayoffMatch(match) {
    return `
        <div class="playoff-match">
            <div class="playoff-match-title">${match.label}</div>
            ${renderPlayoffTeam(match, match.homeTeam, match.homeSeed)}
            ${renderPlayoffTeam(match, match.awayTeam, match.awaySeed)}
        </div>
    `;
}

function renderPlayoffs(bracket = getPlayoffBracket()) {
    const container = document.getElementById('playoffs-bracket');
    if (!container) {
        return;
    }

    if (!bracket) {
        container.innerHTML = '<p>Phase finale indisponible.</p>';
        return;
    }

    const championMarkup = bracket.finale.winner
        ? `<div class="virtual-champion">Champion Virtuel : ${bracket.finale.winner}</div>`
        : '';

    container.innerHTML = `
        <div class="playoff-column">
            <h3>Barrages</h3>
            ${renderPlayoffMatch(bracket.barrage1)}
            ${renderPlayoffMatch(bracket.barrage2)}
        </div>
        <div class="playoff-column">
            <h3>Demies</h3>
            ${renderPlayoffMatch(bracket.demi1)}
            ${renderPlayoffMatch(bracket.demi2)}
        </div>
        <div class="playoff-column playoff-column-final">
            <h3>Finale</h3>
            ${renderPlayoffMatch(bracket.finale)}
            ${championMarkup}
        </div>
    `;
}

function handlePlayoffPick(matchId, teamName) {
    playoffPredictions[matchId] = playoffPredictions[matchId] === teamName ? null : teamName;
    const projectedStandings = getProjectedStandings();
    sanitizePlayoffPredictions(projectedStandings);
    renderPlayoffs(getPlayoffBracket(projectedStandings));
}

function renderMatches() {
    const entry = calendarData[currentRoundIdx];
    const list = document.getElementById('matches-list');

    if (!list) return;

    if (!entry) {
        list.innerHTML = '';
        return;
    }

    if (entry.interlude) {
        list.innerHTML = `<div class="interlude-card">
            ${entry.content ? `<div class="interlude-content">${Array.isArray(entry.content) ? entry.content.join('<br>') : entry.content}</div>` : ''}
        </div>`;
        return;
    }

    if (!isRoundEntry(entry)) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = entry.matches.map((match, mIdx) => {
        const isFuture = match.homePts === null;

        return `<div class="match-row">
            <span class="team-name team-home">${match.homeTeam}</span>
            <div class="score-block">
                ${isFuture ? renderSelect(currentRoundIdx, mIdx, 'home') : `<span class="fixed-score">${match.homePts}</span>`}
                <span>-</span>
                ${isFuture ? renderSelect(currentRoundIdx, mIdx, 'away') : `<span class="fixed-score">${match.awayPts}</span>`}
            </div>
            <span class="team-name team-away">${match.awayTeam}</span>
        </div>`;
    }).join('');
}

function renderSelect(rIdx, mIdx, side) {
    const round = calendarData[rIdx];
    if (!isRoundEntry(round)) return '';

    const match = round.matches[mIdx];
    if (!match) return '';

    const teamName = side === 'home' ? match.homeTeam : match.awayTeam;
    const opponentName = side === 'home' ? match.awayTeam : match.homeTeam;

    const key = getPredictionKey(rIdx, mIdx, teamName);
    const opponentKey = getPredictionKey(rIdx, mIdx, opponentName);

    const selectedValue = userPredictions[key] ?? '';
    const opponentValue = userPredictions[opponentKey] ?? '';
    const allowedScores = getAllowedScores(opponentValue);

    return `<select class="score-selector" onchange="handlePredict(${rIdx}, ${mIdx}, '${side}', this.value)">
        <option value="" ${selectedValue === '' ? 'selected' : ''}>-</option>
        ${allowedScores.map(score => `
            <option value="${score}" ${parseInt(selectedValue, 10) === score ? 'selected' : ''}>${score}</option>
        `).join('')}
    </select>`;
}

function handlePredict(rIdx, mIdx, side, value) {
    const round = calendarData[rIdx];
    if (!isRoundEntry(round)) return;

    const match = round.matches[mIdx];
    if (!match) return;

    const homeKey = getPredictionKey(rIdx, mIdx, match.homeTeam);
    const awayKey = getPredictionKey(rIdx, mIdx, match.awayTeam);

    const currentKey = side === 'home' ? homeKey : awayKey;
    const oppositeKey = side === 'home' ? awayKey : homeKey;

    if (value === '') {
        delete userPredictions[currentKey];
    } else {
        userPredictions[currentKey] = parseInt(value, 10);
    }

    const currentValue = userPredictions[currentKey];
    const oppositeValue = userPredictions[oppositeKey];

    if (currentValue !== undefined) {
        const allowedOppositeScores = getAllowedScores(currentValue);

        if (allowedOppositeScores.length === 1) {
            userPredictions[oppositeKey] = allowedOppositeScores[0];
        } else if (
            oppositeValue !== undefined &&
            !allowedOppositeScores.includes(parseInt(oppositeValue, 10))
        ) {
            delete userPredictions[oppositeKey];
        }
    }

    const projectedStandings = getProjectedStandings();
    sanitizePlayoffPredictions(projectedStandings);
    const completedPrediction = getMatchPrediction(rIdx, mIdx);
    if (completedPrediction) {
        monteCarloResultsStale = true;
    }
    renderMatches();
    renderPlayoffs(getPlayoffBracket(projectedStandings));
    renderMonteCarloResults();
    refreshPredictionWord();
}

const MC_OUTCOMES = [
    [4, 0], [4, 1], [5, 0], [5, 1],
    [0, 4], [1, 4], [0, 5], [1, 5],
    [2, 2]
];

function rankTeamsForSimulation(simPts, simH2H, T, initialOrder) {
    const teams = initialOrder.slice();

    teams.sort((a, b) => {
        const diff = simPts[b] - simPts[a];
        if (diff !== 0) return diff;
        return a - b;
    });

    let i = 0;
    while (i < teams.length) {
        let j = i + 1;
        while (j < teams.length && simPts[teams[j]] === simPts[teams[i]]) {
            j++;
        }

        if (j - i > 1) {
            const tied = teams.slice(i, j);
            const h2hTotals = new Map();

            tied.forEach(a => {
                let total = 0;
                tied.forEach(b => {
                    if (a !== b) {
                        total += simH2H[a * T + b];
                    }
                });
                h2hTotals.set(a, total);
            });

            tied.sort((a, b) => {
                const diff = h2hTotals.get(b) - h2hTotals.get(a);
                if (diff !== 0) return diff;
                return a - b;
            });

            for (let k = 0; k < tied.length; k++) {
                teams[i + k] = tied[k];
            }
        }

        i = j;
    }

    return teams;
}

function runMonteCarloSimulations(N = 100000) {
    const teamNames = standingsData.map(t => t.name);
    const teamIdx = {};
    teamNames.forEach((name, i) => {
        teamIdx[normalizeTeamName(name)] = i;
    });
    const T = teamNames.length;

    const userFixedMatches = [];
    const pendingMatches = [];
    const fixedH2H = new Int32Array(T * T);

    calendarData.forEach((round, rIdx) => {
        if (!isRoundEntry(round)) return;

        round.matches.forEach((match, mIdx) => {
            const hi = teamIdx[normalizeTeamName(match.homeTeam)];
            const ai = teamIdx[normalizeTeamName(match.awayTeam)];
            if (hi === undefined || ai === undefined) return;

            if (match.homePts !== null && match.awayPts !== null) {
                fixedH2H[hi * T + ai] += match.homePts;
                fixedH2H[ai * T + hi] += match.awayPts;
                return;
            }

            const pred = getMatchPrediction(rIdx, mIdx);
            if (pred) {
                userFixedMatches.push({ hi, ai, hp: pred.homePts, ap: pred.awayPts });
            } else {
                pendingMatches.push({ hi, ai });
            }
        });
    });

    const basePoints = standingsData.map(t => t.points);
    const userFixedDelta = new Int32Array(T);

    userFixedMatches.forEach(({ hi, ai, hp, ap }) => {
        userFixedDelta[hi] += hp;
        userFixedDelta[ai] += ap;
        fixedH2H[hi * T + ai] += hp;
        fixedH2H[ai * T + hi] += ap;
    });

    const startPts = basePoints.map((p, i) => p + userFixedDelta[i]);

    const cntTop2 = new Int32Array(T);
    const cntTop6 = new Int32Array(T);
    const cnt13 = new Int32Array(T);
    const cnt14 = new Int32Array(T);

    const nPending = pendingMatches.length;
    const simH2H = new Int32Array(T * T);
    const simPts = new Float64Array(T);
    const initialOrder = Array.from({ length: T }, (_, i) => i);

    for (let sim = 0; sim < N; sim++) {
        for (let i = 0; i < T; i++) simPts[i] = startPts[i];
        simH2H.set(fixedH2H);

        for (let j = 0; j < nPending; j++) {
            const { hi, ai } = pendingMatches[j];
            const [hp, ap] = MC_OUTCOMES[(Math.random() * MC_OUTCOMES.length) | 0];
            simPts[hi] += hp;
            simPts[ai] += ap;
            simH2H[hi * T + ai] += hp;
            simH2H[ai * T + hi] += ap;
        }

        const ranked = rankTeamsForSimulation(simPts, simH2H, T, initialOrder);

        for (let pos = 0; pos < T; pos++) {
            const ti = ranked[pos];
            if (pos < 2) cntTop2[ti]++;
            if (pos < 6) cntTop6[ti]++;
            if (pos === 12) cnt13[ti]++;
            if (pos === 13) cnt14[ti]++;
        }
    }

    const results = {};
    teamNames.forEach((name, i) => {
        results[name] = {
            top2: +(cntTop2[i] / N * 100).toFixed(1),
            top6: +(cntTop6[i] / N * 100).toFixed(1),
            pos13: +(cnt13[i] / N * 100).toFixed(1),
            pos14: +(cnt14[i] / N * 100).toFixed(1)
        };
    });

    return results;
}

function formatPct(pct) {
    if (pct === 0) return `<span class="pct-zero">—</span>`;
    if (pct === 100) return `<span class="pct-certain">✓</span>`;
    const cls = pct >= 50 ? 'pct-high' : pct >= 15 ? 'pct-mid' : 'pct-low';
    return `<span class="${cls}">${pct}%</span>`;
}

function updateMonteCarloButtonLabel() {
    const mcBtn = document.getElementById('mc-run-btn');
    if (!mcBtn) return;

    mcBtn.textContent = monteCarloResults ? 'Recalculer les %' : 'Calculer les %';
}

function renderMonteCarloResults(results = monteCarloResults) {
    const section = document.getElementById('montecarlo-section');
    if (!section) return;

    const standings = getProjectedStandings();
    const deltaMap = getProjectedDeltaMap();
    const staleBadge = monteCarloResultsStale
        ? `<div class="mc-warning">Pourcentages à recalculer</div>`
        : '';

    const syncBadge = standingsSyncWarning
        ? `<div class="mc-warning mc-warning-error">${standingsSyncWarning}</div>`
        : '';

    const overlay = mcLoading
        ? `<div class="mc-overlay" role="status" aria-live="polite" aria-label="Calcul des probabilités en cours">
                <div class="mc-overlay-content">
                    <div class="mc-spinner"></div>
                    <span>100 000 simulations…</span>
                </div>
           </div>`
        : '';

    section.innerHTML = `
        <div class="mc-body-shell" aria-busy="${mcLoading ? 'true' : 'false'}">
            ${syncBadge}
            ${staleBadge}
            <div class="mc-body">
                <table class="mc-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th style="text-align:left">Équipe</th>
                            <th>Pts</th>
                            <th title="Places 1-2 — Demi-finale directe">1-2</th>
                            <th title="Places 1-6 — Qualification en phases finales">1-6</th>
                            <th title="13e — Barrage relégation">13</th>
                            <th title="14e — Relégation directe">14</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${standings.map((team, i) => {
                            const r = monteCarloResultsStale ? null : results?.[team.name];
                            let cls = 'p-neutral';
                            if (i < 2) cls = 'p-direct';
                            else if (i < 6) cls = 'p-playoff';
                            else if (i === 12) cls = 'p-access';
                            else if (i === 13) cls = 'p-releg';

                            return `<tr>
                                <td><span class="pos-badge ${cls}">${i + 1}</span></td>
                                <td style="text-align:left">${team.name}</td>
                                <td>
                                    <strong>${team.points}</strong>
                                    <span class="pts-breakdown">(${team.points - (deltaMap[team.name] || 0)} + ${deltaMap[team.name] || 0})</span>
                                </td>
                                <td>${r ? formatPct(r.top2) : '<span class="pct-zero">…</span>'}</td>
                                <td>${r ? formatPct(r.top6) : '<span class="pct-zero">…</span>'}</td>
                                <td>${r ? formatPct(r.pos13) : '<span class="pct-zero">…</span>'}</td>
                                <td>${r ? formatPct(r.pos14) : '<span class="pct-zero">…</span>'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                ${overlay}
            </div>
        </div>`;
}

async function handleRunSimulation() {
    const btn = document.getElementById('mc-run-btn');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Calcul en cours…';

    mcLoading = true;
    renderMonteCarloResults();

    await new Promise(resolve => setTimeout(resolve, 20));

    monteCarloResults = runMonteCarloSimulations(100000);
    monteCarloResultsStale = false;
    mcLoading = false;

    renderMonteCarloResults();
    updateMonteCarloButtonLabel();
    btn.disabled = false;
}

window.handlePredict = handlePredict;
window.handlePlayoffPick = handlePlayoffPick;
window.handleRunSimulation = handleRunSimulation;

loadData();
