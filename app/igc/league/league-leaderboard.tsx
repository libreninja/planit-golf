'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IGCEvent, IGCWeeklyResult } from '@/lib/igc/league';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy, TrendingUp, TrendingDown, Minus, Calendar } from 'lucide-react';

interface LeagueLeaderboardProps {
  // Base route for this league's standings, e.g. "/igc/mens-league". The week
  // selector navigates to `${basePath}?week=N`.
  basePath: string;
  events: IGCEvent[];
  results: IGCWeeklyResult[];
  selectedEvent: IGCEvent | null;
  selectedWeek?: number;
  hasFlights: boolean;
}

export function LeagueLeaderboard({
  basePath,
  events,
  results,
  selectedEvent,
  selectedWeek,
  hasFlights,
}: LeagueLeaderboardProps) {
  const router = useRouter();
  const [selectedFlight, setSelectedFlight] = useState('overall');

  const handleSelectWeek = (week: number) => {
    router.push(`${basePath}?week=${week}`);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const formatFullDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  // Group results by flight
  const flightsAssigned = results.some((r) => r.flight);

  const groupedResults: Record<string, IGCWeeklyResult[]> = {
    overall: results,
    A: results.filter((r) => r.flight === 'A'),
    B: results.filter((r) => r.flight === 'B'),
    C: results.filter((r) => r.flight === 'C'),
  };

  const currentResults =
    flightsAssigned && selectedFlight !== 'overall'
      ? groupedResults[selectedFlight]
      : results;

  const getPositionIcon = (position: number) => {
    if (position === 1) return <Trophy className="h-4 w-4 text-yellow-500" />;
    if (position === 2) return <Trophy className="h-4 w-4 text-gray-400" />;
    if (position === 3) return <Trophy className="h-4 w-4 text-amber-700" />;
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Event Selector */}
      <div className="flex flex-wrap items-center gap-2">
        {events.slice(0, 8).map((event) => (
          <Button
            key={event.week_number}
            variant={selectedWeek === event.week_number ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSelectWeek(event.week_number)}
          >
            <span>Week {event.week_number}</span>
            <span className="ml-2 text-xs opacity-70">
              {formatDate(event.event_date)}
            </span>
            {event.status === 'live' && (
              <span className="ml-1 text-xs bg-red-100 text-red-700 px-1 rounded">
                LIVE
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {selectedEvent?.event_name || 'Select an event'}
                {selectedEvent?.status === 'live' && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full animate-pulse">
                    LIVE
                  </span>
                )}
              </CardTitle>
              {selectedEvent && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                  <Calendar className="h-4 w-4" />
                  {formatFullDate(selectedEvent.event_date)}
                  {selectedEvent.course_name && (
                    <>
                      <span>•</span>
                      <span>{selectedEvent.course_name}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {flightsAssigned && hasFlights && (
              <Tabs value={selectedFlight} onValueChange={setSelectedFlight}>
                <TabsList>
                  <TabsTrigger value="overall">Overall</TabsTrigger>
                  <TabsTrigger value="A">Flight A</TabsTrigger>
                  <TabsTrigger value="B">Flight B</TabsTrigger>
                  <TabsTrigger value="C">Flight C</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {currentResults.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No results available for this event yet.
            </div>
          ) : (
            <div className="divide-y">
              {currentResults.map((result) => {
                const displayPosition =
                  selectedFlight !== 'overall' && result.flight_position
                    ? result.flight_position
                    : result.position;

                return (
                  <div
                    key={result.player_name}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted font-medium text-sm">
                        {getPositionIcon(displayPosition)}
                        {!getPositionIcon(displayPosition) && displayPosition}
                      </div>
                      <div>
                        <p className="font-medium">{result.player_name}</p>
                        {result.ranking_change !== undefined && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            {result.ranking_change > 0 ? (
                              <>
                                <TrendingUp className="h-3 w-3 text-green-500" />
                                <span className="text-green-600">
                                  +{result.ranking_change}
                                </span>
                              </>
                            ) : result.ranking_change < 0 ? (
                              <>
                                <TrendingDown className="h-3 w-3 text-red-500" />
                                <span className="text-red-600">
                                  {result.ranking_change}
                                </span>
                              </>
                            ) : (
                              <>
                                <Minus className="h-3 w-3" />
                                <span>No change</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      {result.birdies > 0 && (
                        <div className="text-green-600">
                          {result.birdies} birdie
                          {result.birdies !== 1 ? 's' : ''}
                        </div>
                      )}
                      {result.double_bogeys > 0 && (
                        <div className="text-red-600">
                          {result.double_bogeys} double
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
