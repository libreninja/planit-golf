import { NextRequest, NextResponse } from 'next/server';
import { addReaction, removeReaction } from '@/lib/events/feed';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { feed_event_id, reaction_type } = body;

    if (!feed_event_id || !reaction_type) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const reaction = await addReaction(feed_event_id, reaction_type);

    return NextResponse.json({ success: true, reaction });
  } catch (error) {
    console.error('Error adding reaction:', error);

    if (error instanceof Error && error.message === 'Must be logged in to react') {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (error instanceof Error && error.message === 'Already reacted with this emoji') {
      return NextResponse.json(
        { error: 'Already reacted' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to add reaction' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { feed_event_id, reaction_type } = body;

    if (!feed_event_id || !reaction_type) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    await removeReaction(feed_event_id, reaction_type);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing reaction:', error);

    if (error instanceof Error && error.message === 'Must be logged in to remove reaction') {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to remove reaction' },
      { status: 500 }
    );
  }
}
