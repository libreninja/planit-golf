'use client';

import { useState } from 'react';
import { IGCWeeklyResult, IGCEvent } from '@/lib/igc/league';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy, TrendingUp, TrendingDown, Minus, Calendar } from 'lucide-react';

interface LeaderboardProps {
  results: IGCWeeklyResult[];
  event: IGCEvent | null;
  hasFlights: boolean;
}

export function Leaderboard({ results, event, hasFlights }: LeaderboardProps) {
  const [selectedFlight, setSelectedFlight] = useState<string>('overall');

  // Group results by flight if flights are assigned
  const flightsAssigned = results.some((r) => r.flight);

  const groupedResults: Record<string, IGCWeeklyResult[]> = {
    overall: results,
    A: results.filter((r) => r.flight === 'A'),
    B: results.filter((r) => r.flight === 'B'),
    C: results.filter((r) => r.flight === 'C'),
  };

  const currentResults = flightsAssigned && selectedFlight !== 'overall'
    ? groupedResults[selectedFlight]
    : results;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const getPositionIcon = (position: number, flightPosition?: number) => {
    const displayPosition = flightPosition || position;

    if (displayPosition === 1) return <Trophy className="h-4 w-4 text-yellow-500" />;
    if (displayPosition === 2) return <Trophy className="h-4 w-4 text-gray-400" />;
    if (displayPosition === 3) return <Trophy className="h-4 w-4 text-amber-700" />;
    return null;
  };

  if (!event) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Select an event to view the leaderboard
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {event.event_name}
              {event.status === 'live' && (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full animate-pulse">
                  LIVE
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <Calendar className="h-4 w-4" />
              {formatDate(event.event_date)}
              {event.course_name && (
                <>
                  <span>•</span>
                  <span>{event.course_name}</span>
                </>
              )}
            </div>
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
        {!flightsAssigned && hasFlights && (
          <div className="mb-4 p-3 bg-amber-50 text-amber-800 rounded-md text-sm">
            Flights have not been assigned yet. Scores are shown as they come in.
          </div>
        )}

        {currentResults.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No results available for this event yet.
          </div>
        ) : (
          <div className="divide-y">
            {currentResults.map((result, index) => {
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
                      {getPositionIcon(result.position, result.flight_position)}
                      {!getPositionIcon(result.position, result.flight_position) &&
                        displayPosition}
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
                        {result.birdies} birdie{result.birdies !== 1 ? 's' : ''}
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
  );
}
