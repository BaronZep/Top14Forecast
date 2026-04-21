let standingsData = [];
let calendarData = [];
let currentRoundIdx = 0;
let userPredictions = {};

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
    toggle.onchange = () => document.body.classList.toggle('dark-mode');

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
    renderRankings();
    renderMatches();
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

function renderRankings() {
    const body = document.getElementById('rankings-body');
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

    renderMatches();
    renderRankings();
}

window.handlePredict = handlePredict;

loadData();
