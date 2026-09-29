#! /usr/bin/env python3

import json
import sys
import unicodedata
from pathlib import Path
from typing import Optional


def normalize_team_name(name: str) -> str:
    text = str(name or "")
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return text.strip().lower()


def find_team_name(standings_data: list, target_name: str) -> Optional[str]:
    normalized_target = normalize_team_name(target_name)
    for team in standings_data:
        if normalize_team_name(team.get("name")) == normalized_target:
            return team.get("name")
    return None


def main():
    standings_file = Path("standings2627.json")
    calendar_file = Path("calendar2627.json")

    if not standings_file.exists() or not calendar_file.exists():
        print("KO : Fichier(s) introuvable(s)")
        sys.exit(1)

    with open(standings_file, "r", encoding="utf-8") as f:
        standings_data = json.load(f)

    with open(calendar_file, "r", encoding="utf-8") as f:
        calendar_data = json.load(f)

    derived_pts = {team["name"]: 0 for team in standings_data}

    for entry in calendar_data:
        matches = entry.get("matches")
        if not isinstance(matches, list):
            continue

        for match in matches:
            home_pts = match.get("homePts")
            away_pts = match.get("awayPts")

            if home_pts is None or away_pts is None:
                continue

            home_team = find_team_name(standings_data, match.get("homeTeam"))
            away_team = find_team_name(standings_data, match.get("awayTeam"))

            if home_team:
                derived_pts[home_team] += int(home_pts)
            if away_team:
                derived_pts[away_team] += int(away_pts)

    adjustment_entry = next(
        (entry for entry in calendar_data if entry.get("type") == "adjustments"),
        {},
    )
    team_adjustments = adjustment_entry.get("teamAdjustments", {})

    for team_raw_name, delta in team_adjustments.items():
        team = find_team_name(standings_data, team_raw_name)
        if team:
            derived_pts[team] += int(delta or 0)

    mismatches = []
    for team in standings_data:
        team_name = team["name"]
        actual_pts = int(team.get("points", 0))
        expected_pts = derived_pts.get(team_name, 0)

        if actual_pts != expected_pts:
            mismatches.append(f"{team_name} (STANDINGS : {actual_pts} vs CALENDAR : {expected_pts})")

    if mismatches:
        print("KO : " + ", ".join(mismatches))
        sys.exit(1)

    print("OK")
    sys.exit(0)


if __name__ == "__main__":
    main()