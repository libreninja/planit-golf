export interface FollowPolicyInput {
  viewerId: string | null
  golferResolved: boolean
  selfLinked: boolean
}

export type FollowPolicy =
  | { allowed: true }
  | { allowed: false; reason: 'authentication_required' | 'unresolved_golfer' | 'self_follow' }

export function followPolicy(input: FollowPolicyInput): FollowPolicy {
  if (!input.viewerId) return { allowed: false, reason: 'authentication_required' }
  if (!input.golferResolved) return { allowed: false, reason: 'unresolved_golfer' }
  if (input.selfLinked) return { allowed: false, reason: 'self_follow' }
  return { allowed: true }
}
