import { useState } from 'react';
import type {
  ScheduleEvaluationResult,
  WeeklyRequirementsReport,
  TeamWeeklyReport,
  HomeAwayBalanceReport,
  TeamHomeAwayReport,
  ConstraintViolationsReport,
  ConstraintViolation,
  GameDayPreferencesReport,
  DivisionGameDayReport,
  TeamGameDayDistribution,
  GameSpacingReport,
  TeamGameSpacingReport,
  MatchupBalanceReport,
  DivisionMatchupReport,
  TeamMatchupReport,
  MatchupSpacingReport,
  DivisionMatchupSpacingReport,
  GameSlotEfficiencyReport,
  IsolatedGameSlot,
} from '@ll-scheduler/shared';
import styles from './ScheduleEvaluationReport.module.css';

interface Props {
  result: ScheduleEvaluationResult;
  onClose: () => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ScheduleEvaluationReport({ result, onClose }: Props) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const getScoreClass = (score: number) => {
    if (score >= 80) return styles.scoreGood;
    if (score >= 50) return styles.scoreWarning;
    return styles.scoreBad;
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.titleArea}>
            <h2>Schedule Evaluation Report</h2>
            <span className={styles.timestamp}>
              {new Date(result.timestamp).toLocaleString()}
            </span>
          </div>
          <div className={styles.scoreArea}>
            <span className={`${styles.score} ${getScoreClass(result.overallScore)}`}>
              {result.overallScore}%
            </span>
            <span className={styles.scoreLabel}>Overall Score</span>
          </div>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {/* Weekly Requirements */}
          <WeeklyRequirementsSection
            report={result.weeklyRequirements}
            expanded={expandedSections.has('weekly')}
            onToggle={() => toggleSection('weekly')}
          />

          {/* Home/Away Balance */}
          <HomeAwayBalanceSection
            report={result.homeAwayBalance}
            expanded={expandedSections.has('homeAway')}
            onToggle={() => toggleSection('homeAway')}
          />

          {/* Constraint Violations */}
          <ConstraintViolationsSection
            report={result.constraintViolations}
            expanded={expandedSections.has('constraints')}
            onToggle={() => toggleSection('constraints')}
          />

          {/* Game Day Preferences */}
          <GameDayPreferencesSection
            report={result.gameDayPreferences}
            expanded={expandedSections.has('gameDays')}
            onToggle={() => toggleSection('gameDays')}
          />

          {/* Game Spacing */}
          <GameSpacingSection
            report={result.gameSpacing}
            expanded={expandedSections.has('gameSpacing')}
            onToggle={() => toggleSection('gameSpacing')}
          />

          {/* Matchup Balance */}
          <MatchupBalanceSection
            report={result.matchupBalance}
            expanded={expandedSections.has('matchupBalance')}
            onToggle={() => toggleSection('matchupBalance')}
          />

          {/* Matchup Spacing */}
          <MatchupSpacingSection
            report={result.matchupSpacing}
            expanded={expandedSections.has('matchupSpacing')}
            onToggle={() => toggleSection('matchupSpacing')}
          />

          {/* Game Slot Efficiency */}
          <GameSlotEfficiencySection
            report={result.gameSlotEfficiency}
            expanded={expandedSections.has('gameSlotEfficiency')}
            onToggle={() => toggleSection('gameSlotEfficiency')}
          />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  passed,
  summary,
  expanded,
  onToggle,
}: {
  title: string;
  passed: boolean;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.sectionHeader} onClick={onToggle}>
      <div className={styles.sectionStatus}>
        <span className={passed ? styles.statusPass : styles.statusFail}>
          {passed ? '✓' : '✗'}
        </span>
        <span className={styles.sectionTitle}>{title}</span>
      </div>
      <div className={styles.sectionSummary}>{summary}</div>
      <span className={styles.expandIcon}>{expanded ? '▼' : '▶'}</span>
    </div>
  );
}

function WeeklyRequirementsSection({
  report,
  expanded,
  onToggle,
}: {
  report: WeeklyRequirementsReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set());
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const toggleDivision = (divisionId: string) => {
    setExpandedDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(divisionId)) {
        next.delete(divisionId);
      } else {
        next.add(divisionId);
      }
      return next;
    });
  };

  const toggleTeam = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  // Group teams by division
  const teamsByDivision = new Map<string, { divisionName: string; teams: TeamWeeklyReport[] }>();
  for (const team of report.teamReports) {
    if (!teamsByDivision.has(team.divisionId)) {
      teamsByDivision.set(team.divisionId, { divisionName: team.divisionName, teams: [] });
    }
    teamsByDivision.get(team.divisionId)!.teams.push(team);
  }

  // Calculate division-level stats
  const getDivisionStats = (teams: TeamWeeklyReport[]) => {
    const passed = teams.every(t => t.passed);
    const totalIssues = teams.reduce((sum, t) => sum + t.issues.length, 0);
    return { passed, totalIssues };
  };

  return (
    <div className={styles.section}>
      <SectionHeader
        title="Weekly Requirements"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          {teamsByDivision.size === 0 ? (
            <p className={styles.noData}>No team data available</p>
          ) : (
            Array.from(teamsByDivision.entries()).map(([divisionId, { divisionName, teams }]) => {
              const divisionStats = getDivisionStats(teams);
              return (
                <div key={divisionId} className={styles.divisionReport}>
                  <div
                    className={styles.divisionHeader}
                    onClick={() => toggleDivision(divisionId)}
                  >
                    <span className={divisionStats.passed ? styles.statusPass : styles.statusFail}>
                      {divisionStats.passed ? '✓' : '✗'}
                    </span>
                    <span className={styles.divisionName}>{divisionName}</span>
                    {divisionStats.totalIssues > 0 && (
                      <span className={styles.issueCount}>{divisionStats.totalIssues} issues</span>
                    )}
                    <span className={styles.expandIcon}>
                      {expandedDivisions.has(divisionId) ? '▼' : '▶'}
                    </span>
                  </div>

                  {expandedDivisions.has(divisionId) && (
                    <div className={styles.divisionContent}>
                      {/* Division summary table */}
                      <div className={styles.divisionSummary}>
                        <table className={styles.summaryTable}>
                          <thead>
                            <tr>
                              <th>Team</th>
                              <th>Games</th>
                              <th>Practices</th>
                              <th>Cages</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teams.map((team: TeamWeeklyReport) => {
                              const totalGames = team.weeks.reduce((sum, w) => sum + w.gamesScheduled, 0);
                              const totalPractices = team.weeks.reduce((sum, w) => sum + w.practicesScheduled, 0);
                              const totalCages = team.weeks.reduce((sum, w) => sum + w.cagesScheduled, 0);
                              const gamesRequired = team.weeks.reduce((sum, w) => sum + w.gamesRequired, 0);
                              const practicesRequired = team.weeks.reduce((sum, w) => sum + w.practicesRequired, 0);
                              const cagesRequired = team.weeks.reduce((sum, w) => sum + w.cagesRequired, 0);
                              return (
                                <tr key={team.teamId}>
                                  <td>{team.teamName}</td>
                                  <td className={totalGames < gamesRequired ? styles.cellWarning : ''}>
                                    {totalGames}/{gamesRequired}
                                  </td>
                                  <td className={totalPractices < practicesRequired ? styles.cellWarning : ''}>
                                    {totalPractices}/{practicesRequired}
                                  </td>
                                  <td className={cagesRequired > 0 && totalCages < cagesRequired ? styles.cellWarning : ''}>
                                    {totalCages}/{cagesRequired}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {teams.map((team: TeamWeeklyReport) => (
                        <div key={team.teamId} className={styles.teamReport}>
                          <div
                            className={styles.teamHeader}
                            onClick={() => toggleTeam(team.teamId)}
                          >
                            <span className={team.passed ? styles.statusPass : styles.statusFail}>
                              {team.passed ? '✓' : '✗'}
                            </span>
                            <span className={styles.teamName}>{team.teamName}</span>
                            {team.issues.length > 0 && (
                              <span className={styles.issueCount}>{team.issues.length} issues</span>
                            )}
                            <span className={styles.expandIcon}>
                              {expandedTeams.has(team.teamId) ? '▼' : '▶'}
                            </span>
                          </div>
                          {expandedTeams.has(team.teamId) && (
                            <div className={styles.teamDetails}>
                              <table className={styles.weekTable}>
                                <thead>
                                  <tr>
                                    <th>Week</th>
                                    <th>Games</th>
                                    <th>Practices</th>
                                    <th>Cages</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {team.weeks.map((week) => (
                                    <tr key={week.weekStart}>
                                      <td>{week.weekStart}</td>
                                      <td
                                        className={
                                          week.gamesScheduled < week.gamesRequired
                                            ? styles.cellWarning
                                            : ''
                                        }
                                      >
                                        {week.gamesScheduled}/{week.gamesRequired}
                                      </td>
                                      <td
                                        className={
                                          week.practicesScheduled < week.practicesRequired
                                            ? styles.cellWarning
                                            : ''
                                        }
                                      >
                                        {week.practicesScheduled}/{week.practicesRequired}
                                      </td>
                                      <td
                                        className={
                                          week.cagesRequired > 0 &&
                                          week.cagesScheduled < week.cagesRequired
                                            ? styles.cellWarning
                                            : ''
                                        }
                                      >
                                        {week.cagesScheduled}/{week.cagesRequired}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function HomeAwayBalanceSection({
  report,
  expanded,
  onToggle,
}: {
  report: HomeAwayBalanceReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set());

  const toggleDivision = (divisionId: string) => {
    setExpandedDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(divisionId)) {
        next.delete(divisionId);
      } else {
        next.add(divisionId);
      }
      return next;
    });
  };

  // Group teams by division
  const teamsByDivision = new Map<string, { divisionName: string; teams: TeamHomeAwayReport[] }>();
  for (const team of report.teamReports) {
    if (!teamsByDivision.has(team.divisionId)) {
      teamsByDivision.set(team.divisionId, { divisionName: team.divisionName, teams: [] });
    }
    teamsByDivision.get(team.divisionId)!.teams.push(team);
  }

  // Calculate division-level stats
  const getDivisionStats = (teams: TeamHomeAwayReport[]) => {
    const passed = teams.every(t => t.passed);
    const maxBalance = Math.max(...teams.map(t => t.balance));
    return { passed, maxBalance };
  };

  return (
    <div className={styles.section}>
      <SectionHeader
        title="Home/Away Balance"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          {teamsByDivision.size === 0 ? (
            <p className={styles.noData}>No team data available</p>
          ) : (
            Array.from(teamsByDivision.entries()).map(([divisionId, { divisionName, teams }]) => {
              const divisionStats = getDivisionStats(teams);
              return (
                <div key={divisionId} className={styles.divisionReport}>
                  <div
                    className={styles.divisionHeader}
                    onClick={() => toggleDivision(divisionId)}
                  >
                    <span className={divisionStats.passed ? styles.statusPass : styles.statusFail}>
                      {divisionStats.passed ? '✓' : '✗'}
                    </span>
                    <span className={styles.divisionName}>{divisionName}</span>
                    <span className={styles.complianceRate}>
                      Max imbalance: ±{divisionStats.maxBalance}
                    </span>
                    <span className={styles.expandIcon}>
                      {expandedDivisions.has(divisionId) ? '▼' : '▶'}
                    </span>
                  </div>

                  {expandedDivisions.has(divisionId) && (
                    <div className={styles.divisionContent}>
                      <table className={styles.balanceTable}>
                        <thead>
                          <tr>
                            <th>Team</th>
                            <th>Home</th>
                            <th>Away</th>
                            <th>Total</th>
                            <th>Balance</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teams.map((team: TeamHomeAwayReport) => (
                            <tr key={team.teamId}>
                              <td>{team.teamName}</td>
                              <td>{team.homeGames}</td>
                              <td>{team.awayGames}</td>
                              <td>{team.totalGames}</td>
                              <td className={team.balance > 1 ? styles.cellWarning : ''}>
                                {team.balance > 0 ? `±${team.balance}` : '0'}
                              </td>
                              <td>
                                <span className={team.passed ? styles.statusPass : styles.statusFail}>
                                  {team.passed ? '✓' : '✗'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ConstraintViolationsSection({
  report,
  expanded,
  onToggle,
}: {
  report: ConstraintViolationsReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.section}>
      <SectionHeader
        title="Constraint Violations"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          {report.violations.length === 0 ? (
            <p className={styles.noViolations}>No constraint violations found</p>
          ) : (
            <div className={styles.violationsList}>
              {report.violations.map((violation: ConstraintViolation, idx) => (
                <div
                  key={idx}
                  className={`${styles.violation} ${
                    violation.severity === 'error' ? styles.violationError : styles.violationWarning
                  }`}
                >
                  <div className={styles.violationHeader}>
                    <span className={styles.violationType}>
                      {formatViolationType(violation.type)}
                    </span>
                    <span
                      className={
                        violation.severity === 'error'
                          ? styles.severityError
                          : styles.severityWarning
                      }
                    >
                      {violation.severity}
                    </span>
                  </div>
                  <div className={styles.violationDescription}>{violation.description}</div>
                  <div className={styles.violationMeta}>
                    {violation.teamName && <span>Team: {violation.teamName}</span>}
                    {violation.divisionName && <span>Division: {violation.divisionName}</span>}
                    <span>Date: {violation.date}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatViolationType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function GameDayPreferencesSection({
  report,
  expanded,
  onToggle,
}: {
  report: GameDayPreferencesReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set());

  const toggleDivision = (divisionId: string) => {
    setExpandedDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(divisionId)) {
        next.delete(divisionId);
      } else {
        next.add(divisionId);
      }
      return next;
    });
  };

  return (
    <div className={styles.section}>
      <SectionHeader
        title="Game Day Preferences"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          {report.divisionReports.length === 0 ? (
            <p className={styles.noData}>No division data available</p>
          ) : (
            report.divisionReports.map((division: DivisionGameDayReport) => (
              <div key={division.divisionId} className={styles.divisionReport}>
                <div className={styles.divisionHeader}>
                  <span className={division.passed ? styles.statusPass : styles.statusFail}>
                    {division.passed ? '✓' : '✗'}
                  </span>
                  <span className={styles.divisionName}>{division.divisionName}</span>
                  <span className={styles.complianceRate}>
                    {division.complianceRate}% compliance
                  </span>
                </div>

                {division.issues.length > 0 && (
                  <div className={styles.issuesList}>
                    {division.issues.map((issue, idx) => (
                      <div key={idx} className={styles.issue}>
                        {issue}
                      </div>
                    ))}
                  </div>
                )}

                <p className={styles.distributionLabel}>Division Total:</p>
                <div className={styles.dayDistribution}>
                  {DAY_NAMES.map((name, idx) => {
                    const count = division.actualDistribution[idx] || 0;
                    const pref = division.preferences.find((p) => p.dayOfWeek === idx);
                    return (
                      <div key={idx} className={styles.dayColumn}>
                        <div className={styles.dayCount}>{count}</div>
                        <div className={styles.dayName}>{name}</div>
                        {pref && (
                          <div className={`${styles.dayPref} ${styles[pref.priority]}`}>
                            {pref.priority}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Per-team breakdown */}
                {division.teamDistributions && division.teamDistributions.length > 0 && (
                  <div className={styles.teamBreakdown}>
                    <div
                      className={styles.teamBreakdownHeader}
                      onClick={() => toggleDivision(division.divisionId)}
                    >
                      <span className={styles.expandIcon}>
                        {expandedDivisions.has(division.divisionId) ? '▼' : '▶'}
                      </span>
                      <span>Per-Team Breakdown ({division.teamDistributions.length} teams)</span>
                    </div>
                    {expandedDivisions.has(division.divisionId) && (
                      <div className={styles.teamDistributionList}>
                        {division.teamDistributions.map((team: TeamGameDayDistribution) => (
                          <div key={team.teamId} className={styles.teamDistributionRow}>
                            <div className={styles.teamDistributionName}>
                              {team.teamName}
                              <span className={styles.teamGameCount}>({team.totalGames} games)</span>
                            </div>
                            <div className={styles.teamDayDistribution}>
                              {DAY_NAMES.map((name, idx) => {
                                const count = team.distribution[idx] || 0;
                                return (
                                  <div key={idx} className={styles.teamDayColumn}>
                                    <div className={styles.teamDayCount}>{count}</div>
                                    <div className={styles.teamDayName}>{name}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function GameSpacingSection({
  report,
  expanded,
  onToggle,
}: {
  report: GameSpacingReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set());
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const toggleDivision = (divisionId: string) => {
    setExpandedDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(divisionId)) {
        next.delete(divisionId);
      } else {
        next.add(divisionId);
      }
      return next;
    });
  };

  const toggleTeam = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  // Compute gap distribution from gameGaps array
  const computeGapDistribution = (gameGaps: number[]): Record<number, number> => {
    const distribution: Record<number, number> = {};
    for (const gap of gameGaps) {
      distribution[gap] = (distribution[gap] || 0) + 1;
    }
    return distribution;
  };

  // Group teams by division
  const teamsByDivision = new Map<string, { divisionName: string; teams: TeamGameSpacingReport[] }>();
  for (const team of report.teamReports) {
    if (!teamsByDivision.has(team.divisionId)) {
      teamsByDivision.set(team.divisionId, { divisionName: team.divisionName, teams: [] });
    }
    teamsByDivision.get(team.divisionId)!.teams.push(team);
  }

  // Calculate division-level stats
  const getDivisionStats = (teams: TeamGameSpacingReport[]) => {
    const teamsWithGames = teams.filter(t => t.totalGames >= 2);
    if (teamsWithGames.length === 0) return { avg: 0, passed: true };
    const avg = teamsWithGames.reduce((sum, t) => sum + t.averageDaysBetweenGames, 0) / teamsWithGames.length;
    const passed = teams.every(t => t.passed);
    return { avg: Math.round(avg * 10) / 10, passed };
  };

  return (
    <div className={styles.section}>
      <SectionHeader
        title="Game Spacing"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          <div className={styles.overallAverage}>
            Overall Average: <strong>{report.overallAverageDaysBetweenGames}</strong> days between games
          </div>
          {teamsByDivision.size === 0 ? (
            <p className={styles.noData}>No team data available</p>
          ) : (
            Array.from(teamsByDivision.entries()).map(([divisionId, { divisionName, teams }]) => {
              const divisionStats = getDivisionStats(teams);
              return (
                <div key={divisionId} className={styles.divisionReport}>
                  <div
                    className={styles.divisionHeader}
                    onClick={() => toggleDivision(divisionId)}
                  >
                    <span className={divisionStats.passed ? styles.statusPass : styles.statusFail}>
                      {divisionStats.passed ? '✓' : '✗'}
                    </span>
                    <span className={styles.divisionName}>{divisionName}</span>
                    <span className={styles.complianceRate}>
                      Avg: {divisionStats.avg} days
                    </span>
                    <span className={styles.expandIcon}>
                      {expandedDivisions.has(divisionId) ? '▼' : '▶'}
                    </span>
                  </div>

                  {expandedDivisions.has(divisionId) && (
                    <div className={styles.divisionContent}>
                      {teams.map((team) => {
                        const gapDistribution = computeGapDistribution(team.gameGaps || []);
                        const gapKeys = Object.keys(gapDistribution).map(Number).sort((a, b) => a - b);
                        const isTeamExpanded = expandedTeams.has(team.teamId);

                        return (
                          <div key={team.teamId} className={styles.teamReport}>
                            <div
                              className={styles.teamHeader}
                              onClick={() => toggleTeam(team.teamId)}
                            >
                              <span className={team.passed ? styles.statusPass : styles.statusFail}>
                                {team.passed ? '✓' : '✗'}
                              </span>
                              <span className={styles.teamName}>{team.teamName}</span>
                              <span className={styles.teamGameCount}>
                                {team.totalGames} games, avg {team.averageDaysBetweenGames || 0} days
                              </span>
                              <span className={styles.expandIcon}>
                                {isTeamExpanded ? '▼' : '▶'}
                              </span>
                            </div>

                            {isTeamExpanded && (
                              <div className={styles.teamDetails}>
                                <div className={styles.spacingStats}>
                                  <span>Min: {team.minDaysBetweenGames || '-'} days</span>
                                  <span>Max: {team.maxDaysBetweenGames || '-'} days</span>
                                  <span>Avg: {team.averageDaysBetweenGames || '-'} days</span>
                                </div>

                                {gapKeys.length > 0 ? (
                                  <div className={styles.gapDistribution}>
                                    <div className={styles.gapDistributionLabel}>Gap Distribution:</div>
                                    <div className={styles.gapBars}>
                                      {gapKeys.map((gap) => (
                                        <div key={gap} className={styles.gapBar}>
                                          <div className={styles.gapBarLabel}>{gap}d</div>
                                          <div
                                            className={`${styles.gapBarFill} ${gap <= 2 ? styles.gapBarWarning : ''}`}
                                            style={{ width: `${Math.min(gapDistribution[gap] * 30, 100)}px` }}
                                          >
                                            {gapDistribution[gap]}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <p className={styles.noData}>Not enough games to show gap distribution</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function MatchupBalanceSection({
  report,
  expanded,
  onToggle,
}: {
  report: MatchupBalanceReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const toggleTeam = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  return (
    <div className={styles.section}>
      <SectionHeader
        title="Matchup Balance"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          {report.divisionReports.length === 0 ? (
            <p className={styles.noData}>No division data available</p>
          ) : (
            report.divisionReports.map((division: DivisionMatchupReport) => (
              <div key={division.divisionId} className={styles.divisionReport}>
                <div className={styles.divisionHeader}>
                  <span className={division.passed ? styles.statusPass : styles.statusFail}>
                    {division.passed ? '✓' : '✗'}
                  </span>
                  <span className={styles.divisionName}>{division.divisionName}</span>
                  <span className={styles.complianceRate}>
                    Ideal: {division.idealGamesPerMatchup} games/matchup
                  </span>
                </div>

                <div className={styles.matchupSummary}>
                  Max imbalance: {division.maxImbalance} games from ideal
                </div>

                {division.teamMatchups.map((team: TeamMatchupReport) => (
                  <div key={team.teamId} className={styles.teamReport}>
                    <div
                      className={styles.teamHeader}
                      onClick={() => toggleTeam(`${division.divisionId}-${team.teamId}`)}
                    >
                      <span className={styles.teamName}>
                        {team.teamName}
                      </span>
                      <span className={styles.teamGameCount}>
                        {team.totalGames} total games
                      </span>
                      <span className={styles.expandIcon}>
                        {expandedTeams.has(`${division.divisionId}-${team.teamId}`) ? '▼' : '▶'}
                      </span>
                    </div>
                    {expandedTeams.has(`${division.divisionId}-${team.teamId}`) && (
                      <div className={styles.teamDetails}>
                        <table className={styles.matchupTable}>
                          <thead>
                            <tr>
                              <th>Opponent</th>
                              <th>Games</th>
                              <th>Home</th>
                              <th>Away</th>
                              <th>H/A Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {team.opponents.map((opp) => {
                              const diff = Math.abs(opp.gamesPlayed - division.idealGamesPerMatchup);
                              const homeAwayDiff = Math.abs(opp.homeGames - opp.awayGames);
                              // Imbalance is bad if one team is home significantly more often
                              // For 2 games: diff > 0 is unavoidable; for 3+: diff > 1 is bad
                              const homeAwayImbalanced = opp.gamesPlayed >= 2 && homeAwayDiff > 1;
                              return (
                                <tr key={opp.opponentId}>
                                  <td>{opp.opponentName}</td>
                                  <td className={diff > 1 ? styles.cellWarning : ''}>
                                    {opp.gamesPlayed}
                                  </td>
                                  <td className={homeAwayImbalanced ? styles.cellWarning : ''}>
                                    {opp.homeGames}
                                  </td>
                                  <td className={homeAwayImbalanced ? styles.cellWarning : ''}>
                                    {opp.awayGames}
                                  </td>
                                  <td className={homeAwayImbalanced ? styles.cellWarning : styles.cellOk}>
                                    {homeAwayImbalanced ? `⚠ ${homeAwayDiff > 1 ? 'Unbalanced' : ''}` : '✓'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MatchupSpacingSection({
  report,
  expanded,
  onToggle,
}: {
  report: MatchupSpacingReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.section}>
      <SectionHeader
        title="Matchup Spacing"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          {report.divisionReports.length === 0 ? (
            <p className={styles.noData}>No division data available</p>
          ) : (
            report.divisionReports.map((division: DivisionMatchupSpacingReport) => (
              <div key={division.divisionId} className={styles.divisionReport}>
                <div className={styles.divisionHeader}>
                  <span className={division.passed ? styles.statusPass : styles.statusFail}>
                    {division.passed ? '✓' : '✗'}
                  </span>
                  <span className={styles.divisionName}>{division.divisionName}</span>
                  <span className={styles.complianceRate}>
                    Min: {division.minSpacing} days, Avg: {division.avgSpacing} days
                  </span>
                </div>

                {/* Spacing Matrix */}
                <div className={styles.spacingMatrixContainer}>
                  <table className={styles.spacingMatrix}>
                    <thead>
                      <tr>
                        <th></th>
                        {division.teams.map((team) => (
                          <th key={team.id} className={styles.matrixHeader}>
                            {team.name.replace(/^Team\s*/, '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {division.teams.map((team, rowIdx) => (
                        <tr key={team.id}>
                          <td className={styles.matrixRowHeader}>
                            {team.name.replace(/^Team\s*/, '')}
                          </td>
                          {division.teams.map((_, colIdx) => {
                            const gaps = division.spacingMatrix[rowIdx][colIdx];
                            const isLowSpacing = gaps.some(g => g < 7);
                            return (
                              <td
                                key={colIdx}
                                className={`${styles.matrixCell} ${
                                  rowIdx === colIdx ? styles.matrixDiagonal : ''
                                } ${isLowSpacing ? styles.matrixWarning : ''}`}
                              >
                                {rowIdx === colIdx ? '-' : gaps.length > 0 ? gaps.join(', ') : '-'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={styles.matrixHelp}>
                  Values show days between consecutive games for each team pair
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function GameSlotEfficiencySection({
  report,
  expanded,
  onToggle,
}: {
  report: GameSlotEfficiencyReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.section}>
      <SectionHeader
        title="Game Slot Efficiency"
        passed={report.passed}
        summary={report.summary}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className={styles.sectionContent}>
          <div className={styles.efficiencyStats}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Total Games:</span>
              <span className={styles.statValue}>{report.totalGameSlots}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>With Concurrent Games:</span>
              <span className={styles.statValue}>{report.concurrentSlots}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Isolated (no overlap):</span>
              <span className={`${styles.statValue} ${report.isolatedSlots > 0 ? styles.statWarning : ''}`}>
                {report.isolatedSlots}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Efficiency Rate:</span>
              <span className={`${styles.statValue} ${report.efficiencyRate < 70 ? styles.statWarning : ''}`}>
                {report.efficiencyRate}%
              </span>
            </div>
          </div>

          {report.isolatedSlotDetails.length > 0 && (
            <>
              <h4 className={styles.subHeader}>Isolated Games (no other games in progress)</h4>
              <table className={styles.isolatedSlotsTable}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Field</th>
                    <th>Matchup</th>
                    <th>Division</th>
                  </tr>
                </thead>
                <tbody>
                  {report.isolatedSlotDetails.map((slot: IsolatedGameSlot, idx) => (
                    <tr key={idx}>
                      <td>{slot.date}</td>
                      <td>{slot.startTime} - {slot.endTime}</td>
                      <td>{slot.fieldName}</td>
                      <td>{slot.homeTeamName} vs {slot.awayTeamName}</td>
                      <td>{slot.divisionName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
