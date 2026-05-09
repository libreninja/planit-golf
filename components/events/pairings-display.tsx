interface PairingsDisplayProps {
  editionId: string;
}

export function PairingsDisplay({ editionId }: PairingsDisplayProps) {
  return (
    <div className="rounded-md border border-border bg-white/80 p-6">
      <h3 className="mb-4 text-lg font-semibold">Pairings</h3>
      <p className="text-sm text-muted-foreground">
        Tee time pairings will appear here after Golf Genius sync.
      </p>
    </div>
  );
}
