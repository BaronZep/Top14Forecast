let standingsData = [];
let calendarData = [];
let currentRoundIdx = 0;
let userPredictions = {};
let playoffPredictions = {
    barrage1: null,
    barrage2: null,
    demi1: null,
    demi2: null,
    finale: null
};

const SCORE_OPTIONS = [0, 1, 2, 4, 5];
const SCORE_COMPATIBILITY = {
    0: [4, 5],
    1: [4, 5],
    2: [2],
    4: [0, 1],
    5: [0, 1]
};

async function loadData() {
    try {
        const [sRes, cRes] = await Promise.all([
            fetch('standings.json'),
            fetch('calendar.json')
        ]);

        standingsData = await sRes.json();
        calendarData = await cRes.json();

        currentRoundIdx = calendarData.findIndex(round =>
            round.matches.some(match => match.homePts === null)
        );

        if (currentRoundIdx === -1) {
            currentRoundIdx = calendarData.length - 1;
        }

        initUI();
    } catch (e) {
        console.error('Utilisez Live Server !', e);
    }
}

function initUI() {
    const toggle = document.getElementById('dark-mode-toggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    // Initialise theme from system preference
    function applyTheme(dark) {
        document.body.classList.toggle('dark-mode', dark);
        document.body.classList.toggle('light-mode', !dark);
        toggle.checked = dark;
    }

    applyTheme(prefersDark.matches);

    // Follow system changes in real-time (only if user hasn't overridden)
    prefersDark.addEventListener('change', e => {
        if (!toggle.dataset.manualOverride) {
            applyTheme(e.matches);
        }
    });

    // Manual toggle: mark as override, stop following system
    toggle.onchange = () => {
        toggle.dataset.manualOverride = '1';
        applyTheme(toggle.checked);
    };

    document.getElementById('prev-btn').onclick = () => changeRound(-1);
    document.getElementById('next-btn').onclick = () => changeRound(1);

    updateDisplay();
}

function changeRound(step) {
    const newIdx = currentRoundIdx + step;

    if (newIdx >= 0 && newIdx < calendarData.length) {
        currentRoundIdx = newIdx;
        updateDisplay();
    }
}

function updateDisplay() {
    const projectedStandings = getProjectedStandings();
    sanitizePlayoffPredictions(projectedStandings);
    const playoffBracket = getPlayoffBracket(projectedStandings);

    renderRankings(projectedStandings);
    renderMatches();
    renderPlayoffs(playoffBracket);
    document.getElementById('round-label').innerText = `Journée ${calendarData[currentRoundIdx].round}`;
}

function getPredictionKey(rIdx, mIdx, teamName) {
    return `R${rIdx}|M${mIdx}|${teamName}`;
}

function getMatchPrediction(rIdx, mIdx) {
    const match = calendarData[rIdx].matches[mIdx];
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
        round.matches.forEach((match, mIdx) => {
            if (match.homePts !== null && match.awayPts !== null) {
                return;
            }

            const prediction = getMatchPrediction(rIdx, mIdx);
            if (!prediction) {
                return;
            }

            const homeTeam = live.find(team => team.name === match.homeTeam);
            const awayTeam = live.find(team => team.name === match.awayTeam);

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

        return 0;
    });

    return live;
}

function renderRankings(live = getProjectedStandings()) {
    const body = document.getElementById('rankings-body');

    body.innerHTML = live.map((team, i) => {
        let cls = 'p-neutral';

        if (i < 2) cls = 'p-direct';
        else if (i < 6) cls = 'p-playoff';
        else if (i === 12) cls = 'p-access';
        else if (i === 13) cls = 'p-releg';

        return `<tr>
            <td><span class="pos-badge ${cls}">${i + 1}</span></td>
            <td style="text-align: left;">${team.name}</td>
            <td><strong>${team.points}</strong></td>
        </tr>`;
    }).join('');
}

function calculateHeadToHead(teamA, teamB) {
    let ptsA = 0;
    let ptsB = 0;

    calendarData.forEach((round, rIdx) => {
        round.matches.forEach((match, mIdx) => {
            const isHeadToHead =
                (match.homeTeam === teamA && match.awayTeam === teamB) ||
                (match.homeTeam === teamB && match.awayTeam === teamA);

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

            if (match.homeTeam === teamA) {
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

    const barrage1Winner = barrage1Participants.includes(playoffPredictions.barrage1)
        ? playoffPredictions.barrage1
        : null;

    const barrage2Winner = barrage2Participants.includes(playoffPredictions.barrage2)
        ? playoffPredictions.barrage2
        : null;

    const demi1Participants = [seeds.rank1, barrage1Winner].filter(Boolean);
    const demi2Participants = [seeds.rank2, barrage2Winner].filter(Boolean);

    const demi1Winner = demi1Participants.includes(playoffPredictions.demi1)
        ? playoffPredictions.demi1
        : null;

    const demi2Winner = demi2Participants.includes(playoffPredictions.demi2)
        ? playoffPredictions.demi2
        : null;

    const finaleParticipants = [demi1Winner, demi2Winner].filter(Boolean);
    const finaleWinner = finaleParticipants.includes(playoffPredictions.finale)
        ? playoffPredictions.finale
        : null;

    return {
        barrage1: {
            id: 'barrage1',
            label: 'Barrage 1',
            homeTeam: seeds.rank4,
            awayTeam: seeds.rank5,
            homeSeed: '#4',
            awaySeed: '#5',
            winner: barrage1Winner
        },
        barrage2: {
            id: 'barrage2',
            label: 'Barrage 2',
            homeTeam: seeds.rank3,
            awayTeam: seeds.rank6,
            homeSeed: '#3',
            awaySeed: '#6',
            winner: barrage2Winner
        },
        demi1: {
            id: 'demi1',
            label: 'Demi-finale 1',
            homeTeam: seeds.rank1,
            awayTeam: barrage1Winner,
            homeSeed: '#1',
            awaySeed: barrage1Winner
                ? (barrage1Winner === seeds.rank4 ? '#4' : '#5')
                : null,
            winner: demi1Winner
        },
        demi2: {
            id: 'demi2',
            label: 'Demi-finale 2',
            homeTeam: seeds.rank2,
            awayTeam: barrage2Winner,
            homeSeed: '#2',
            awaySeed: barrage2Winner
                ? (barrage2Winner === seeds.rank3 ? '#3' : '#6')
                : null,
            winner: demi2Winner
        },
        finale: {
            id: 'finale',
            label: 'Finale',
            homeTeam: demi1Winner,
            awayTeam: demi2Winner,
            homeSeed: demi1Winner
                ? (demi1Winner === seeds.rank1 ? '#1' : (demi1Winner === seeds.rank4 ? '#4' : '#5'))
                : null,
            awaySeed: demi2Winner
                ? (demi2Winner === seeds.rank2 ? '#2' : (demi2Winner === seeds.rank3 ? '#3' : '#6'))
                : null,
            winner: finaleWinner
        }
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
    const list = document.getElementById('matches-list');
    const round = calendarData[currentRoundIdx];

    list.innerHTML = round.matches.map((match, mIdx) => {
        const isFuture = match.homePts === null;

        return `<div class="match-row">
            <span class="team-name team-home">${match.homeTeam}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
                ${isFuture ? renderSelect(currentRoundIdx, mIdx, 'home') : `<span class="fixed-score">${match.homePts}</span>`}
                <span>-</span>
                ${isFuture ? renderSelect(currentRoundIdx, mIdx, 'away') : `<span class="fixed-score">${match.awayPts}</span>`}
            </div>
            <span class="team-name team-away">${match.awayTeam}</span>
        </div>`;
    }).join('');
}

function renderSelect(rIdx, mIdx, side) {
    const match = calendarData[rIdx].matches[mIdx];
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
    const match = calendarData[rIdx].matches[mIdx];

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
    renderMatches();
    renderRankings(projectedStandings);
    renderPlayoffs(getPlayoffBracket(projectedStandings));
}


window.handlePredict = handlePredict;
window.handlePlayoffPick = handlePlayoffPick;

loadData();
