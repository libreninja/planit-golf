// Golf Genius API Integration for planit.golf
// Used for IGC League leaderboard and weekly reports

export {
  getEvents,
  getEventRounds,
  getSeasons,
  getCategories,
  type GGEvent,
  type GGRound,
} from "./events";

export {
  getRoundTournaments,
  getTournamentResults,
  getSeasonPointsCategories,
  getSeasonPointsStandings,
  type GGTournament,
  type GGAggregate,
  type SeasonPointsStanding,
} from "./tournaments";

export { getEventCourses, type GGCourse } from "./courses";

export {
  generateWeeklyLeagueReport,
  generateBlogPost,
  type WeeklyPerformance,
  type WeeklyReport,
  type Storyline,
} from "./weekly-report";
