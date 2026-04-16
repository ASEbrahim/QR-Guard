import { sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { ScanError } from './scan-error.js';
import { GEOFENCE_INDOOR_MARGIN_M } from '../config/constants.js';

/**
 * Layer 5: PostGIS geofence check.
 * Casts the WKT text geofence_center via ST_GeogFromText, then uses ST_DWithin
 * with the indoor margin (+15m).
 *
 * @param {string} courseId
 * @param {number} lat — student GPS latitude
 * @param {number} lng — student GPS longitude
 * @throws {ScanError} code='outside_geofence' if student is outside the geofence
 */
export async function checkGeofence(courseId, lat, lng) {
  const result = await db.execute(sql`
    SELECT ST_DWithin(
      ST_GeogFromText(geofence_center),
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      geofence_radius_m + ${GEOFENCE_INDOOR_MARGIN_M}
    ) AS within
    FROM courses
    WHERE course_id = ${courseId}
  `);

  if (!result.rows || result.rows.length === 0) {
    throw new ScanError('Course not found', 'course_not_found');
  }

  if (!result.rows[0].within) {
    throw new ScanError('Outside classroom area', 'outside_geofence');
  }
}
