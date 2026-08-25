"use client";

import { useEffect, useMemo, useCallback, useState } from "react";

type Lead = {
  id: number;
  sessionId: string;
  userQuery: string;
  interestedDomain: string | null;
  topic: string | null;
  phoneNumber: string | null;
  contactRequested: boolean;
  contactStatus: "pending" | "contacted" | "completed";
  createdAt: string;
};

type StatusFilter = "all" | "pending" | "contacted" | "completed";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<Lead["contactStatus"]>("pending");
  const [editPhone, setEditPhone] = useState("");

  const adminPassword = useMemo(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("ask-adtu-admin-pw") ?? "";
  }, []);

  const counts = useMemo(() => {
    const c = { all: total, pending: 0, contacted: 0, completed: 0 };
    for (const l of leads) {
      if (l.contactStatus in c) c[l.contactStatus]++;
    }
    return c;
  }, [leads, total]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        headers: { Authorization: `Bearer ${adminPassword}` },
      });
      if (res.status === 401) {
        setAuthenticated(false);
        sessionStorage.removeItem("ask-adtu-admin-pw");
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch leads: ${res.status} ${text}`);
      }
      const data = await res.json();
      setLeads(data.leads);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [adminPassword, statusFilter, setAuthenticated, setLeads, setLoading, setTotal]);

  useEffect(() => {
    const stored = sessionStorage.getItem("ask-adtu-admin-pw");
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthenticated(true);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (authenticated && mounted) {
      const id = setTimeout(() => {
        fetchLeads();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [authenticated, mounted, statusFilter, adminPassword, fetchLeads]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    sessionStorage.setItem("ask-adtu-admin-pw", password.trim());
    setAuthenticated(true);
    setPassword("");
  }

  async function saveEdit(id: number) {
    await fetch("/api/admin/leads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminPassword}`,
      },
      body: JSON.stringify({ id, contactStatus: editStatus, phoneNumber: editPhone || undefined }),
    });
    setEditingId(null);
    fetchLeads();
  }

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
        <div className="text-sm text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8">
          <h1 className="text-xl font-semibold text-zinc-100">Admin Access</h1>
          <p className="text-sm text-zinc-400">Enter the admin password to view counseling leads.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-zinc-100 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-300"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <header className="sticky top-0 z-20 flex w-full items-center justify-between border-b border-zinc-800 bg-[#09090b]/90 px-6 py-4 backdrop-blur-md">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Counseling Leads</h1>
          <p className="text-xs text-zinc-500">Unanswered queries and student contact requests</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            {counts.pending} pending / {counts.contacted} contacted / {counts.completed} completed
          </span>
          <button
            onClick={() => {
              sessionStorage.removeItem("ask-adtu-admin-pw");
              setAuthenticated(false);
            }}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex gap-2">
          {(["all", "pending", "contacted", "completed"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === s
                  ? "bg-zinc-100 text-zinc-900"
                  : "border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {s} ({counts[s]})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-zinc-500">Loading leads...</div>
        ) : leads.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-500">No leads found.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/50 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Session</th>
                  <th className="px-4 py-3 font-medium">Query</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Topic</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Requested</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-zinc-900/30">
                    <td className="px-4 py-3 text-zinc-400">{lead.id}</td>
                    <td className="max-w-40 truncate px-4 py-3 font-mono text-xs text-zinc-500">
                      {lead.sessionId}
                    </td>
                    <td className="max-w-75 whitespace-normal wrap-break-word px-4 py-3 align-top text-zinc-200" title={lead.userQuery}>
                      {lead.userQuery}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{lead.interestedDomain ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-300">{lead.topic ?? "-"}</td>
                    <td className="px-4 py-3 font-mono text-zinc-300">{lead.phoneNumber ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          lead.contactRequested
                            ? "bg-emerald-950/40 text-emerald-300"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {lead.contactRequested ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === lead.id ? (
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as Lead["contactStatus"])}
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:outline-none"
                        >
                          <option value="pending">Pending</option>
                          <option value="contacted">Contacted</option>
                          <option value="completed">Completed</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            lead.contactStatus === "pending"
                              ? "bg-amber-950/40 text-amber-300"
                              : lead.contactStatus === "contacted"
                                ? "bg-sky-950/40 text-sky-300"
                                : "bg-emerald-950/40 text-emerald-300"
                          }`}
                        >
                          {lead.contactStatus}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-top text-zinc-400">{formatDate(lead.createdAt)}</td>
                    <td className="px-4 py-3">
                      {editingId === lead.id ? (
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            placeholder="Phone"
                            className="w-32 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit(lead.id)}
                              className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-300"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingId(lead.id);
                            setEditStatus(lead.contactStatus);
                            setEditPhone(lead.phoneNumber ?? "");
                          }}
                          className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
