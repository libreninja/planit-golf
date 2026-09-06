export const FOLLOW_STATE_EVENT = 'planit:golfer-follow-state'

export interface FollowStateEventDetail {
  golferId: string
  following: boolean
}
