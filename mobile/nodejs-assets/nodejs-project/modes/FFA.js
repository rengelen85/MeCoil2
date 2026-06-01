import { BaseMode } from './BaseMode.js';

export class FFA extends BaseMode {
  _areTeammates(_a, _b) {
    return false;
  }

  _buildScores() {
    return [...this.players.values()]
      .map(p => ({ id: p.id, username: p.username, kills: p.kills, deaths: p.deaths }))
      .sort((a, b) => b.kills - a.kills);
  }

  _determineWinner() {
    const scores = this._buildScores();
    return scores[0] ?? null;
  }

  _checkWinCondition(scorer, limit) {
    return scorer.kills >= limit;
  }
}
