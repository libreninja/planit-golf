// Golf Genius Courses API
import { makeGolfGeniusRequest } from "./client";

export interface GGTee {
  name: string;
  hole_data?: {
    par?: number[];
    yards?: number[];
  };
}

export interface GGCourse {
  id: string;
  name: string;
  tees?: GGTee[];
}

export interface GGCoursesResponse {
  courses?: GGCourse[];
}

export async function getEventCourses(params: {
  event_id: string;
}): Promise<GGCoursesResponse> {
  return makeGolfGeniusRequest<GGCoursesResponse>({
    endpoint: `/events/${params.event_id}/courses`,
  });
}
