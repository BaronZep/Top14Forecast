let standingsData = [];
let calendarData = [];
let currentRoundIdx = 0;
let userPredictions = {};
async function loadData() {
   try {
       const [sRes, cRes] = await Promise.all([fetch('standings.json'), fetch('calendar.json')]);
       standingsData = await sRes.json();
       calendarData = await cRes.json();
       currentRoundIdx = calendarData.findIndex(r => r.matches.some(m => m.homePts === null));
       if (currentRoundIdx === -1) currentRoundIdx = calendarData.length - 1;
       initUI();
   } catch (e) { console.error("Utilisez Live Server !", e); }
}
function initUI() {
   const toggle = document.getElementById('dark-mode-toggle');
   toggle.onchange = () => document.body.classList.toggle('dark-mode');
   document.getElementById('prev-btn').onclick = () => changeRound(-1);
   document.getElementById('next-btn').onclick = () => changeRound(1);
   updateDisplay();
}
function changeRound(step) {
   let newIdx = currentRoundIdx + step;
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
function renderRankings() {
   const body = document.getElementById('rankings-body');
   let live = standingsData.map(t => ({ ...t }));
   Object.keys(userPredictions).forEach(key => {
       const [,,teamName] = key.split('|');
       const team = live.find(t => t.name === teamName);
       if (team) team.points += parseInt(userPredictions[key]);
   });
   live.sort((a, b) => b.points - a.points);
   body.innerHTML = live.map((t, i) => {
       let cls = "p-neutral";
       if (i < 2) cls = "p-direct";
       else if (i < 6) cls = "p-playoff";
       else if (i === 12) cls = "p-access";
       else if (i === 13) cls = "p-releg";
       return `<tr>
<td><span class="pos-badge ${cls}">${i+1}</span></td>
<td style="text-align: left;">${t.name}</td>
<td><strong>${t.points}</strong></td>
</tr>`;
   }).join('');
}
function renderMatches() {
   const list = document.getElementById('matches-list');
   const round = calendarData[currentRoundIdx];
   list.innerHTML = round.matches.map((m, mIdx) => {
       const isFuture = m.homePts === null;
       return `<div class="match-row">
<span class="team-name team-home">${m.homeTeam}</span>
<div style="display: flex; gap: 8px; align-items: center;">
               ${isFuture ? renderSelect(currentRoundIdx, mIdx, m.homeTeam) : `<span class="fixed-score">${m.homePts}</span>`}
<span>-</span>
               ${isFuture ? renderSelect(currentRoundIdx, mIdx, m.awayTeam) : `<span class="fixed-score">${m.awayPts}</span>`}
</div>
<span class="team-name team-away">${m.awayTeam}</span>
</div>`;
   }).join('');
}
function renderSelect(rIdx, mIdx, teamName) {
   const key = `R${rIdx}|M${mIdx}|${teamName}`;
   const val = userPredictions[key] || 0;
   return `<select class="score-selector" onchange="handlePredict('${key}', this.value)">
       ${[0,1,2,4,5].map(o => `<option value="${o}" ${val==o?'selected':''}>${o}</option>`).join('')}
</select>`;
}
window.handlePredict = (key, val) => {
   userPredictions[key] = val;
   renderRankings();
};
loadData();