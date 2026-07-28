interface StandingsDisplayProps {
  editionId: string;
}

export function StandingsDisplay({ editionId }: StandingsDisplayProps) {
  return (
    <div className="rounded-md border border-border bg-white/80 p-6">
      <h3 className="mb-4 text-lg font-semibold">Standings</h3>
      <p className="text-sm text-muted-foreground">
        Standings will appear here after Golf Genius sync.
      </p>
    </div>
  );
}
