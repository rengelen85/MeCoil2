import { BaseMode } from './BaseMode.js';
import { TEAMS } from '../../shared/messages.js';

export class TeamDeathmatch extends BaseMode {
  _areTeammates(a, b) {
    return a.team !== TEAMS.NONE && a.team === b.team;
  }

  _teamKills(team) {
    return [...this.players.values()]
      .filter(p => p.team === team)
      .reduce((sum, p) => sum + p.kills, 0);
  }

  _buildScores() {
    const teams = [TEAMS.RED, TEAMS.BLUE].map(team => ({
      team,
      kills: this._teamKills(team),
      players: [...this.players.values()]
        .filter(p => p.team === team)
        .map(p => ({ id: p.id, username: p.username, kills: p.kills, deaths: p.deaths })),
    }));
    return teams.sort((a, b) => b.kills - a.kills);
  }

  _determineWinner() {
    const scores = this._buildScores();
    return scores[0]?.kills > scores[1]?.kills ? scores[0].team : 'draw';
  }

  _checkWinCondition(scorer, limit) {
    return this._teamKills(scorer.team) >= limit;
  }
}
