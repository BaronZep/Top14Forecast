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
let chartInstance = null;
let lockedTeam = null;   
let hoveredTeam = null;  

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

function initTieBadgeTooltips() {
    document.addEventListener('mouseover', e => {
        const badge = e.target.closest('.tie-badge');
        if (!badge) return;
        const box = badge.parentElement?.querySelector('.tie-box');
        if (!box) return;

        const rect = badge.getBoundingClientRect();
        const boxWidth = Math.min(380, window.innerWidth - 20);

        let left = rect.left;
        if (left + boxWidth > window.innerWidth - 10) left = window.innerWidth - boxWidth - 10;
        if (left < 10) left = 10;

        const arrowLeft = Math.max(8, Math.min(rect.left + rect.width / 2 - left, boxWidth - 18));

        box.style.left = left + 'px';
        box.style.top = (rect.bottom + 8) + 'px';
        box.style.setProperty('--tie-arrow-left', arrowLeft + 'px');
        box.style.visibility = 'visible';
        box.style.opacity = '1';
    });

    document.addEventListener('mouseout', e => {
        const badge = e.target.closest('.tie-badge');
        if (!badge) return;
        const box = badge.parentElement?.querySelector('.tie-box');
        if (!box) return;
        box.style.visibility = 'hidden';
        box.style.opacity = '0';
    });
}

function initUI() {
    const themeSlider = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme(dark) {
        document.body.classList.toggle('dark-mode', dark);
        document.body.classList.toggle('light-mode', !dark);
        themeSlider.setAttribute('aria-checked', dark ? 'true' : 'false');

        if (typeof Chart !== 'undefined' && chartInstance) {
            updateChartTheme();
        }
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

    initTieBadgeTooltips();
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
    
    if (typeof Chart !== 'undefined') {
        renderChart();
    }
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

    live.sort((a, b) => b.points - a.points);

    let i = 0;
    while (i < live.length) {
        let j = i + 1;
        while (j < live.length && live[j].points === live[i].points) j++;
        if (j - i > 1) {
            const sorted = sortTiedGroup(live.slice(i, j));
            for (let k = 0; k < sorted.length; k++) live[i + k] = sorted[k];
        }
        i = j;
    }

    return live;
}

// --- Tie-breaking helpers (LNR criteria order) ---

const TIE_SHORT_NAMES = {
    'Stade Toulousain': 'ST',
    'Stade Rochelais': 'SR',
    'Stade Français Paris': 'SFP',
    'Union Bordeaux-Bègles': 'UBB',
    'ASM Clermont': 'ASM',
    'Montpellier Hérault Rugby': 'MHR',
    'Section Paloise': 'SP',
    'LOU Rugby': 'LOU',
    'RC Toulon': 'RCT',
    'Aviron Bayonnais': 'AB',
    'Racing 92': 'R92',
    'Castres Olympique': 'CO',
    'USA Perpignan': 'USAP',
    'US Montauban': 'USM',
};
function shortTeamName(name) { return TIE_SHORT_NAMES[name] || name; }

function calculateHeadToHeadWithScore(teamA, teamB) {
    const normA = normalizeTeamName(teamA);
    const normB = normalizeTeamName(teamB);
    let ptsA = 0, ptsB = 0, scoreA = 0, scoreB = 0, hasScore = false;

    calendarData.forEach((round, rIdx) => {
        if (!isRoundEntry(round)) return;
        round.matches.forEach((match, mIdx) => {
            const mHome = normalizeTeamName(match.homeTeam);
            const mAway = normalizeTeamName(match.awayTeam);
            if (!((mHome === normA && mAway === normB) || (mHome === normB && mAway === normA))) return;

            let hp = match.homePts, ap = match.awayPts;
            if (hp === null || ap === null) {
                const pred = getMatchPrediction(rIdx, mIdx);
                if (!pred) return;
                hp = pred.homePts; ap = pred.awayPts;
            }
            if (mHome === normA) { ptsA += hp; ptsB += ap; } else { ptsA += ap; ptsB += hp; }

            if (match.homeScore !== null && match.awayScore !== null) {
                hasScore = true;
                if (mHome === normA) { scoreA += match.homeScore; scoreB += match.awayScore; }
                else                 { scoreA += match.awayScore; scoreB += match.homeScore; }
            }
        });
    });
    return { ptsA, ptsB, scoreA, scoreB, hasScore };
}

function computeGeneralScoreStats(names) {
    const normMap = new Map(names.map(n => [normalizeTeamName(n), n]));
    const stats = Object.fromEntries(names.map(n => [n, { diff: 0, scored: 0 }]));
    calendarData.forEach(round => {
        if (!isRoundEntry(round)) return;
        round.matches.forEach(match => {
            if (match.homeScore === null || match.awayScore === null) return;
            const hn = normMap.get(normalizeTeamName(match.homeTeam));
            const an = normMap.get(normalizeTeamName(match.awayTeam));
            if (hn) { stats[hn].diff += match.homeScore - match.awayScore; stats[hn].scored += match.homeScore; }
            if (an) { stats[an].diff += match.awayScore - match.homeScore; stats[an].scored += match.awayScore; }
        });
    });
    return stats;
}

function computeCriteriaForGroup(group) {
    const names = group.map(t => t.name);

    // Keys always in alphabetical order so lookup is consistent
    const pairH2H = new Map();
    for (let a = 0; a < group.length; a++)
        for (let b = a + 1; b < group.length; b++) {
            const na = group[a].name, nb = group[b].name;
            const raw = calculateHeadToHeadWithScore(na, nb);
            if (na < nb) {
                pairH2H.set(`${na}||${nb}`, raw);
            } else {
                pairH2H.set(`${nb}||${na}`, { ptsA: raw.ptsB, ptsB: raw.ptsA, scoreA: raw.scoreB, scoreB: raw.scoreA, hasScore: raw.hasScore });
            }
        }

    const h2hPts = new Map(), h2hDiff = new Map();
    let anyH2HScore = false;
    names.forEach(name => {
        let pts = 0, diff = 0, hasScore = false;
        names.forEach(other => {
            if (other === name) return;
            const key = name < other ? `${name}||${other}` : `${other}||${name}`;
            const h = pairH2H.get(key);
            const first = name < other;
            pts += first ? h.ptsA : h.ptsB;
            if (h.hasScore) {
                hasScore = true;
                diff += first ? h.scoreA - h.scoreB : h.scoreB - h.scoreA;
            }
        });
        h2hPts.set(name, pts);
        h2hDiff.set(name, hasScore ? diff : null);
        if (hasScore) anyH2HScore = true;
    });

    const gen = computeGeneralScoreStats(names);
    const genDiff   = new Map(names.map(n => [n, gen[n].diff]));
    const genScored = new Map(names.map(n => [n, gen[n].scored]));

    return [
        { key: 'h2hPts',      label: 'Pts H2H',          values: h2hPts,    available: true },
        { key: 'genDiff',     label: 'G-A gén.',          values: genDiff,   available: true },
        { key: 'h2hDiff',     label: 'G-A H2H',           values: h2hDiff,   available: anyH2HScore },
        { key: 'h2hEssais',   label: 'Diff. ess. H2H',    values: null,      available: false },
        { key: 'genEssais',   label: 'Diff. ess. gén.',   values: null,      available: false },
        { key: 'genScored',   label: 'Pts gén.',           values: genScored, available: true },
        { key: 'essaisGen',   label: 'Ess. gén.',          values: null,      available: false },
        { key: 'forfaits',    label: 'Forfaits',           values: null,      available: false },
        { key: 'saisonPrec',  label: 'Saison préc.',       values: null,      available: false },
    ];
}

// Linear progressive tie-break: apply criteria in order WITHOUT restarting.
// Once a criterion splits the teams, still-tied sub-groups continue to the NEXT
// criterion (they do not re-evaluate earlier criteria). Returns the ordered teams
// and, if `out` is provided, fills it with per-team decisive info for badges.
function resolveTieGroup(teams, criteria, startCi, out) {
    if (teams.length === 1) return teams;
    for (let ci = startCi; ci < criteria.length; ci++) {
        const crit = criteria[ci];
        if (!crit.available || !crit.values) continue;
        const vals = teams.map(t => crit.values.get(t.name));
        if (vals.some(v => v === null)) continue;
        if (new Set(vals).size === 1) continue;

        const subMax = Math.max(...vals);
        const distinctVals = [...new Set(vals)].sort((a, b) => b - a);
        const result = [];
        for (const val of distinctVals) {
            const bucket = teams.filter(t => crit.values.get(t.name) === val);
            if (bucket.length === 1) {
                if (out) out.set(bucket[0].name, { type: 'E', decisiveCritIdx: ci, decisiveValue: val, decisiveWinner: val === subMax });
                result.push(bucket[0]);
            } else {
                result.push(...resolveTieGroup(bucket, criteria, ci + 1, out));
            }
        }
        return result;
    }
    // No remaining criterion can separate these teams: still tied (E!)
    const alpha = [...teams].sort((a, b) => normalizeTeamName(a.name).localeCompare(normalizeTeamName(b.name)));
    if (out) alpha.forEach(t => out.set(t.name, { type: 'E!', decisiveCritIdx: -1, decisiveValue: null, decisiveWinner: false }));
    return alpha;
}

function sortTiedGroup(group) {
    if (group.length <= 1) return group;
    return resolveTieGroup(group, computeCriteriaForGroup(group), 0, null);
}

function computeTieBadges(standings) {
    const badges = new Map();
    let i = 0;
    while (i < standings.length) {
        let j = i + 1;
        while (j < standings.length && standings[j].points === standings[i].points) j++;
        if (j - i > 1) {
            const group = standings.slice(i, j);
            const criteria = computeCriteriaForGroup(group);
            const perTeam = new Map();
            resolveTieGroup(group, criteria, 0, perTeam);
            const groupDecisive = new Map(group.map(t => [t.name, perTeam.get(t.name).decisiveCritIdx]));
            const groupDecisiveWinner = new Map(group.map(t => [t.name, perTeam.get(t.name).decisiveWinner]));
            group.forEach(team => {
                const { type, decisiveCritIdx } = perTeam.get(team.name);
                badges.set(team.name, { type, compareGroup: group, decisiveCritIdx, criteria, groupDecisive, groupDecisiveWinner });
            });
        }
        i = j;
    }
    return badges;
}

function fmtCritVal(key, v) {
    if (v === null || v === undefined) return '—';
    if (key === 'genDiff' || key === 'h2hDiff') return (v >= 0 ? '+' : '') + v;
    return String(v);
}

function renderTieBadge(teamName, badge) {
    if (!badge) return '';
    const { type, compareGroup, decisiveCritIdx, criteria, groupDecisive, groupDecisiveWinner } = badge;
    const isAlert = type === 'E!';

    const teamNames = compareGroup.map(t => t.name);
    const shorts = teamNames.map(shortTeamName);

    const LABEL_W = 108, VAL_W = 46;
    const cols = `${LABEL_W}px ${teamNames.map(() => `${VAL_W}px`).join(' ')}`;

    // Per-column gold: a team's name is gold if it ranks first in its sub-group split
    const headerGold = teamNames.map(n => groupDecisiveWinner?.get(n) === true);

    const headerCells =
        `<div class="tc-th-label"></div>` +
        shorts.map((s, idx) => {
            const gold = headerGold[idx] ? ` style="color:#cba052;opacity:1"` : '';
            return `<div class="tc-th"${gold}>${s}</div>`;
        }).join('');

    const dataCells = criteria.flatMap((crit, ci) => {
        let rowClass;
        if (!crit.available || !crit.values) {
            rowClass = 'tc-unavail';
        } else if (ci === decisiveCritIdx) {
            rowClass = 'tc-decisive';
        } else if (decisiveCritIdx >= 0 && ci > decisiveCritIdx) {
            rowClass = 'tc-grayed';
        } else {
            const vals = teamNames.map(n => crit.values.get(n));
            rowClass = new Set(vals).size === 1 ? 'tc-equal' : 'tc-prior-partial';
        }

        const labelDiv = `<div class="tc-label-cell ${rowClass}"><span class="tc-rank">${ci + 1}</span>${crit.label}</div>`;
        const valDivs = teamNames.map((n, idx) => {
            const isTeamDecisive = ci === (groupDecisive?.get(n) ?? -1);
            // Always show the full-group value (complete H2H against all concerned teams).
            const v = (crit.values && crit.available) ? crit.values.get(n) : null;
            const isGold = isTeamDecisive && headerGold[idx];
            let style = '';
            if (isGold)              style = 'color:#cba052;font-weight:700';
            else if (isTeamDecisive) style = 'font-weight:700';
            return `<div class="tc-val ${rowClass}"${style ? ` style="${style}"` : ''}>${fmtCritVal(crit.key, v)}</div>`;
        });
        return [labelDiv, ...valDivs];
    }).join('');

    const table = `<div class="tie-grid" style="grid-template-columns:${cols}">${headerCells}${dataCells}</div>`
        + `<div class="tie-footnote">— Données non disponibles</div>`;
    const badgeClass = isAlert ? 'tie-badge tie-badge-alert' : 'tie-badge tie-badge-resolved';
    return `<span class="tie-wrap"><span class="${badgeClass}" tabindex="0">${type}</span><span class="tie-box">${table}</span></span>`;
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
    const tieBadges = computeTieBadges(standings);
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
                            <th></th>
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
                                <td>${renderTieBadge(team.name, tieBadges.get(team.name))}</td>
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

function getPointsHistory() {
    const history = {};
    const teams = standingsData.map(t => normalizeTeamName(t.name));
    
    // Initialisation (J0 avec ajustements éventuels)
    const adjustments = getTeamAdjustments();
    teams.forEach(team => {
        history[team] = { 
            data: [adjustments[team] || 0]
        };
    });

    let currentPoints = { ...adjustments };
    teams.forEach(t => { if(currentPoints[t] === undefined) currentPoints[t] = 0; });
    
    // Point de rupture : à partir de quelle journée passe-t-on en prédiction (pointillé)
    let firstPredictedRound = null;
    let roundCounter = 1;

    calendarData.forEach((entry, rIdx) => {
        if (!isRoundEntry(entry)) return;
        
        let hasPrediction = false;
        
        entry.matches.forEach((match, mIdx) => {
            const hTeam = normalizeTeamName(match.homeTeam);
            const aTeam = normalizeTeamName(match.awayTeam);
            
            if (match.homePts !== null && match.awayPts !== null) {
                currentPoints[hTeam] += match.homePts;
                currentPoints[aTeam] += match.awayPts;
            } else {
                hasPrediction = true;
                const prediction = getMatchPrediction(rIdx, mIdx);
                if (prediction) {
                    currentPoints[hTeam] += prediction.homePts;
                    currentPoints[aTeam] += prediction.awayPts;
                }
            }
        });

        teams.forEach(team => history[team].data.push(currentPoints[team]));
        
        if (hasPrediction && firstPredictedRound === null) {
            firstPredictedRound = roundCounter;
        }
        roundCounter++;
    });

    return { history, firstPredictedRound };
}

function updateChartTheme() {
    if (!chartInstance) return;
    
    // On va lire la couleur de texte actuelle calculée par le navigateur
    const bodyStyles = window.getComputedStyle(document.body);
    const textColor = bodyStyles.getPropertyValue('--text').trim() || '#444'; // '--text' est la variable de votre CSS

    // Mise à jour de la couleur des axes (x et y)
    chartInstance.options.scales.x.ticks.color = textColor;
    chartInstance.options.scales.y.ticks.color = textColor;
    chartInstance.options.scales.y.title.color = textColor;

    // Mise à jour de la couleur de la légende
    chartInstance.options.plugins.legend.labels.color = textColor;

    chartInstance.update();
}

function updateHighlights() {
    if (!chartInstance) return;
    
    chartInstance.data.datasets.forEach(dataset => {
        const team = dataset.label.toLowerCase();
        
        // Si une équipe est verrouillée au clic, c'est elle (et SEULEMENT elle) qui s'allume.
        // Sinon, on allume l'équipe survolée.
        const isHighlighted = lockedTeam ? (lockedTeam === team) : (hoveredTeam === team);
        const isLocked = lockedTeam === team;

        // La ligne passe en surbrillance
        dataset.borderColor = isHighlighted ? '#cba052' : 'rgba(150, 150, 150, 0.2)';
        dataset.borderWidth = isHighlighted ? 4 : 2;
        
        // Les points (ronds) ne s'affichent QUE si l'équipe est cliquée (verrouillée)
        dataset.pointRadius = isLocked ? 4 : 0;
        dataset.hoverRadius = isLocked ? 6 : 0;
        
        // On pousse la ligne active au premier plan pour qu'elle passe par-dessus les autres
        dataset.order = isHighlighted ? 1 : 2;
    });
    if (!lockedTeam && chartInstance.tooltip) {
        chartInstance.tooltip.setActiveElements([], {x: 0, y: 0});
    }
    
    chartInstance.update();
}

function renderChart() {
    const ctx = document.getElementById('pointsChart');
    if (!ctx) return;

    const { history, firstPredictedRound } = getPointsHistory();
    const sortedTeams = getProjectedStandings().map(team => normalizeTeamName(team.name));
    const labels = Array.from({length: history[sortedTeams[0]].data.length}, (_, i) => i === 0 ? 'Base' : `J${i}`);

    const datasets = sortedTeams.map(team => {
        return {
            label: team.toUpperCase(),
            data: history[team].data,
            borderColor: 'rgba(150, 150, 150, 0.2)',
            borderWidth: 2,
            pointRadius: 0,
            hitRadius: 15, // Zone invisible large pour "attraper" la ligne facilement
            hoverRadius: 0,
            pointBackgroundColor: '#cba052',
            tension: 0.1, 
            segment: {
                borderDash: ctx => {
                    if (firstPredictedRound !== null && ctx.p0DataIndex >= firstPredictedRound) {
                        return [5, 5]; 
                    }
                    return undefined; 
                }
            }
        };
    });

    if (chartInstance) {
        chartInstance.data.labels = labels;
        chartInstance.data.datasets = datasets;
    } else {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: {
                    padding: { right: 20, bottom: 10, left: 10 }
                },
                interaction: {
                    mode: 'nearest',
                    intersect: true
                },
                // Action au survol (souris sur PC)
                onHover: (event, elements, chart) => {
                    let newHovered = null;
                    if (elements && elements.length > 0) {
                        newHovered = chart.data.datasets[elements[0].datasetIndex].label.toLowerCase();
                    }
                    // Met à jour seulement si la ligne survolée change
                    if (hoveredTeam !== newHovered) {
                        hoveredTeam = newHovered;
                        updateHighlights();
                    }
                },
                // Action au clic (PC et Mobile)
                onClick: (event, elements, chart) => {
                    if (elements && elements.length > 0) {
                        // Verrouille l'équipe cliquée
                        lockedTeam = chart.data.datasets[elements[0].datasetIndex].label.toLowerCase();
                    } else {
                        // Clic dans le vide = on désélectionne
                        lockedTeam = null;
                    }
                    updateHighlights();
                },
                plugins: {
                    tooltip: { 
                        enabled: true,
                        displayColors: false, // Plus de petit carré de couleur
                        events: ['click'] // L'infobulle ne s'affichera/bougera QUE via un clic !
                    },
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 0, 
                            padding: 15,
                            font: { size: 11 },
                            // 1. Force l'ordre d'origine de la légende pour éviter que le survol désorganise tout
                            itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
                            
                            // 2. Génère les étiquettes avec la bonne couleur
                            generateLabels: (chart) => {
                                // On récupère la couleur par défaut (qui s'adapte au mode sombre grâce à updateChartTheme)
                                const defaultColor = chart.options.plugins.legend.labels.color || '#444';
                                
                                return chart.data.datasets.map((dataset, i) => {
                                    const team = dataset.label.toLowerCase();
                                    const isHighlighted = lockedTeam ? (lockedTeam === team) : (hoveredTeam === team);
                                    
                                    return {
                                        text: dataset.label,
                                        // On passe en doré si sélectionné, sinon couleur classique
                                        fontColor: isHighlighted ? '#cba052' : defaultColor,
                                        datasetIndex: i
                                    };
                                });
                            }
                        },
                        onClick: (e, legendItem, legend) => {
                            const clickedTeam = legendItem.text.toLowerCase();
                            
                            if (lockedTeam !== clickedTeam && legend.chart.tooltip) {
                                legend.chart.tooltip.setActiveElements([], {x: 0, y: 0});
                            }
                            
                            lockedTeam = lockedTeam === clickedTeam ? null : clickedTeam;
                            hoveredTeam = null; 
                            
                            updateHighlights(); 
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: 'var(--text)' } },
                    y: { 
                        title: { display: true, text: 'Points', color: 'var(--text)' },
                        ticks: { color: 'var(--text)' }
                    }
                }
            }
        });
    }

    updateHighlights();
    updateChartTheme();
}

window.handlePredict = handlePredict;
window.handlePlayoffPick = handlePlayoffPick;
window.handleRunSimulation = handleRunSimulation;

loadData();
