import { tool } from "ai";
import { z } from "zod";
import { createLead } from "@/db/store";

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

export function counselingTool(sessionId: string, userQuery: string) {
  return tool({
    description:
      "CAPTURE A COUNSELING LEAD. Call this tool IMMEDIATELY when the user has agreed to be contacted AND has provided their phone number. This tool stores the lead in the database so the counseling team can follow up. You MUST call this tool - do not just acknowledge the phone number in your text response. The counseling team will handle the actual phone call. Along with the phone number, pass interestedDomain (the programme/branch the student asked about, inferred from the whole conversation) and topic (what they want help with, e.g. fee structure, eligibility, scholarship).",
    inputSchema: z.object({
      phoneNumber: z.string().min(7).describe("The student's phone number that they just provided in the chat. Use the exact number they gave."),
      contactRequested: z.boolean().default(true).describe("Set to true - the user has agreed to be contacted"),
      interestedDomain: z
        .string()
        .optional()
        .describe(
          "The academic programme or branch the student is interested in, inferred from the conversation - e.g. 'B.Tech CSE', 'MBA', 'Humanities', 'B.Sc Nursing', 'Law'. Use the student's actual field of interest, NOT a default. Omit only if the student never indicated any programme or field.",
        ),
      topic: z
        .string()
        .optional()
        .describe(
          "What the student wants the counseling team to help them with, inferred from the conversation - e.g. 'fee structure', 'eligibility', 'scholarship', 'admission process', 'hostel', 'placements'. Omit only if genuinely unclear.",
        ),
    }),
    execute: async ({ phoneNumber, contactRequested, interestedDomain, topic }) => {
      await createLead({
        sessionId,
        userQuery,
        interestedDomain: interestedDomain ?? null,
        topic: topic ?? null,
        phoneNumber,
        contactRequested,
      });
      return {
        success: true,
        message: "Your request has been noted. Our counseling team will contact you soon.",
      };
    },
  });
}

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
