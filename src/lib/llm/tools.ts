import { tool } from "ai";
import { z } from "zod";

const SIMULATED_NOTE =
  "SIMULATED DEMO DATA - this is a mock service for demonstration, not a real university record. Present it to the user with that caveat.";

function hashStatus(id: string): number {
  let h = 0;
  for (const ch of id.toUpperCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const APP_STATUSES = [
  { stage: "Received", detail: "Application received and queued for document verification." },
  { stage: "Under Review", detail: "Documents verified; eligibility check in progress." },
  { stage: "Counselling Shortlisted", detail: "Shortlisted for the next counselling/interview round." },
  { stage: "Offer Letter Issued", detail: "Provisional admission offer issued - complete fee payment to confirm seat." },
  { stage: "Enrolled", detail: "Admission confirmed. Welcome to AdtU!" },
];

export const adtuTools = {
  get_application_status: tool({
    description:
      "Look up an admission application status for the given application ID (e.g. ADTU2026-12345). Returns SIMULATED demo data.",
    inputSchema: z.object({
      applicationId: z
        .string()
        .min(4)
        .describe("The application ID printed on the applicant's confirmation email"),
    }),
    execute: async ({ applicationId }) => {
      const s = APP_STATUSES[hashStatus(applicationId) % APP_STATUSES.length];
      const dayOffset = hashStatus(applicationId) % 9;
      return {
        applicationId,
        status: s.stage,
        detail: s.detail,
        lastUpdated: new Date(Date.now() - dayOffset * 86_400_000).toISOString().slice(0, 10),
        disclaimer: SIMULATED_NOTE,
      };
    },
  }),

  get_exam_schedule: tool({
    description:
      "Fetch the upcoming end-semester examination timetable for a programme and semester. Returns SIMULATED demo data.",
    inputSchema: z.object({
      programme: z.string().min(2).describe("Programme name, e.g. B.Tech CSE, B.Sc Nursing, MBA"),
      semester: z.number().int().min(1).max(10).optional(),
    }),
    execute: ({ programme, semester }) => ({
      programme,
      semester: semester ?? null,
      session: "Odd Semester 2026",
      papers: [
        { code: `${programme.slice(0, 3).toUpperCase()}-301`, title: "Core Paper I", date: "2026-11-23", time: "09:30-12:30" },
        { code: `${programme.slice(0, 3).toUpperCase()}-302`, title: "Core Paper II", date: "2026-11-26", time: "09:30-12:30" },
        { code: `${programme.slice(0, 3).toUpperCase()}-303`, title: "Elective", date: "2026-11-30", time: "14:00-17:00" },
        { code: `${programme.slice(0, 3).toUpperCase()}-304`, title: "Open Elective / MOOC", date: "2026-12-03", time: "09:30-12:30" },
      ],
      disclaimer: SIMULATED_NOTE,
      officialSource: "adtu.in/exam",
    }),
  }),
};
