// Mode-specific Golf Genius facts captured 2026-09-22 for Men's Week 23
// (Tim Eichelberger) and Women's Week 17 (Jamie Lim). Net comes from the Net
// tournament, never from the Gross payload's embedded net_scores.
export const weeklyScorecardFixtures = [
  {
    league: 'mens', week: 23, name: 'Tim Eichelberger',
    memberCardId: '2925267430701819571', handicapStrokes: [1, 1, 0, 0, 1, 1, 1, 1, 1],
    gross: [5, 3, 2, 3, 3, 4, 5, 4, 3],
    grossToPar: [1, 0, -1, 0, 0, 1, 2, 1, 0], grossTotal: 32, grossPar: 4,
    net: [4, 2, 2, 3, 2, 3, 4, 3, 2],
    netToPar: [0, -1, -1, 0, -1, 0, 1, 0, -1], netTotal: 25, netPar: -3,
  },
  {
    league: 'womens', week: 17, name: 'Jamie Lim',
    memberCardId: '11464114002137737023', handicapStrokes: [2, 1, 1, 1, 2, 2, 2, 1, 2],
    gross: [4, 5, 3, 4, 3, 5, 4, 5, 5],
    grossToPar: [0, 2, 0, 1, 0, 2, 1, 2, 2], grossTotal: 38, grossPar: 10,
    net: [2, 4, 2, 3, 1, 3, 2, 4, 3],
    netToPar: [-2, 1, -1, 0, -2, 0, -1, 1, 0], netTotal: 24, netPar: -4,
  },
] as const
