export const INCIDENT_LABELS = ["updated", "investigating", "identified", "monitoring", "resolved"] as const;

export type IncidentLabel = (typeof INCIDENT_LABELS)[number];
