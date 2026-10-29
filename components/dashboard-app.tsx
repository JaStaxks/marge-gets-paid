"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useState } from "react";

import { formatUsd } from "@/lib/money";
import { statusLabel } from "@/lib/metrics";
import { SHOP } from "@/lib/shop";
import type { Job } from "@/lib/types";
import type { Kpis } from "@/lib/metrics";

let gridReady = false;
function ensureGrid() {
  if (gridReady) return;
  ModuleRegistry.registerModules([AllCommunityModule]);
  gridReady = true;
}

const theme = themeQuartz.withParams({
  accentColor: "#1f6f62",
  backgroundColor: "#fffaf3",
  foregroundColor: "#1c1712",
  headerBackgroundColor: "#123244",
  headerTextColor: "#f3ecdf",
  borderColor: "#e4d7c6",
  browserColorScheme: "light",
});

function StatusCell(props: ICellRendererParams<Job, Job["status"]>) {
  const value = props.value;
  if (!value) return null;
  return <span className={`chip chip-${value}`}>{statusLabel(value)}</span>;
}

function LinkCell(props: ICellRendererParams<Job, string>) {
  if (!props.value) return <span className="muted">—</span>;
  const external = props.value.startsWith("http");
  return (
    <a href={props.value} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
      Open
    </a>
  );
}

export function DashboardApp({
  initialJobs,
  initialKpis,
  store,
}: {
  initialJobs: Job[];
  initialKpis: Kpis;
  store: "redis" | "file";
}) {
  ensureGrid();
  const [jobs, setJobs] = useState(initialJobs);
  const [totals, setTotals] = useState(initialKpis);
  const [selectedId, setSelectedId] = useState<string | null>(initialJobs[0]?.id ?? null);
  const [note, setNote] = useState("Replaced anode rod, flushed tank, 1.5 hr");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  async function refresh() {
    const response = await fetch("/api/jobs");
    if (!response.ok) return;
    const body = (await response.json()) as { jobs: Job[]; kpis: Kpis };
    setJobs(body.jobs);
    setTotals(body.kpis);
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const columnDefs = useMemo<ColDef<Job>[]>(
    () => [
      { field: "customerName", headerName: "Customer", flex: 1.1, minWidth: 130 },
      { field: "serviceName", headerName: "Service", flex: 1.3, minWidth: 150 },
      { field: "slotLabel", headerName: "Slot", flex: 1.2, minWidth: 150 },
      { field: "status", headerName: "Status", cellRenderer: StatusCell, minWidth: 130, maxWidth: 150 },
      {
        headerName: "Deposit",
        valueGetter: (params) => formatUsd(params.data?.depositCents ?? 0),
        minWidth: 100,
        maxWidth: 120,
      },
      {
        headerName: "Invoice balance",
        valueGetter: (params) => (params.data?.invoiceTotalCents != null ? formatUsd(params.data.invoiceTotalCents) : "—"),
        minWidth: 130,
        maxWidth: 160,
      },
      {
        headerName: "Pay link",
        valueGetter: (params) => (params.data ? `/pay/${params.data.id}` : ""),
        cellRenderer: LinkCell,
        minWidth: 100,
        maxWidth: 120,
      },
      { field: "invoiceUrl", headerName: "Invoice", cellRenderer: LinkCell, minWidth: 100, maxWidth: 120 },
    ],
    [],
  );

  return (
    <main className="board">
      <div className="board-head">
        <div>
          <p className="muted">{SHOP.name} · owner desk</p>
          <h1 style={{ fontFamily: "var(--font-display), Georgia, serif", margin: "4px 0" }}>Jobs on the board</h1>
          <p className="muted">Store: {store === "redis" ? "Upstash Redis" : "local JSON file"}. The grid refreshes every few seconds.</p>
        </div>
        <div className="board-actions">
          <button type="button" className="ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (!window.confirm("Reset the board to the sample jobs?")) return;
              const response = await fetch("/api/admin/reset", { method: "POST" });
              if (!response.ok) {
                setMessage("Reset failed.");
                return;
              }
              const body = (await response.json()) as { jobs: Job[]; kpis: Kpis };
              setJobs(body.jobs);
              setTotals(body.kpis);
              setSelectedId(body.jobs[0]?.id ?? null);
              setMessage("Board reset.");
            }}
          >
            Reset demo
          </button>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              await fetch("/api/dashboard/logout", { method: "POST" });
              window.location.href = "/dashboard";
            }}
          >
            Log out
          </button>
        </div>
      </div>
      <section className="kpis" aria-label="Shop totals">
        <article className="kpi">
          <span>Booked</span>
          <strong>{totals.booked}</strong>
        </article>
        <article className="kpi">
          <span>Deposits collected</span>
          <strong>{formatUsd(totals.depositsCollectedCents)}</strong>
        </article>
        <article className="kpi">
          <span>Outstanding</span>
          <strong>{formatUsd(totals.outstandingCents)}</strong>
        </article>
        <article className="kpi">
          <span>Paid</span>
          <strong>{formatUsd(totals.paidCents)}</strong>
        </article>
      </section>
      <div className="grid-card">
        <AgGridReact<Job>
          theme={theme}
          rowData={jobs}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          domLayout="autoHeight"
          onRowClicked={(event) => {
            if (event.data) setSelectedId(event.data.id);
          }}
          animateRows
        />
      </div>
      {selected ? (
        <section className="detail">
          <article className="panel">
            <h2 style={{ marginTop: 0 }}>
              {selected.customerName} <span className={`chip chip-${selected.status}`}>{statusLabel(selected.status)}</span>
            </h2>
            <p>
              {selected.serviceName} · {selected.slotLabel}
              <br />
              {selected.address}
              <br />
              {selected.phone} · {selected.email}
            </p>
            <p>{selected.issue}</p>
            <p>
              Quote {formatUsd(selected.quoteCents)} · deposit {formatUsd(selected.depositCents)}
              {selected.orderVia ? ` · order via ${selected.orderVia}` : ""}
              {selected.paypalOrderId ? ` · ${selected.paypalOrderId}` : ""}
            </p>
            {selected.lines ? (
              <table className="lines">
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.code}>
                      <td>
                        {line.name} × {line.quantity}
                      </td>
                      <td>{formatUsd(line.amountCents)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Deposit already paid</td>
                    <td>{formatUsd(-(selected.depositCreditCents ?? 0))}</td>
                  </tr>
                  <tr>
                    <td>Balance due</td>
                    <td>{formatUsd(selected.invoiceTotalCents ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            {selected.invoiceId ? <p>Invoice {selected.invoiceId}</p> : null}
            {selected.invoiceUrl ? (
              <p>
                <a href={selected.invoiceUrl} target="_blank" rel="noreferrer">
                  Open PayPal invoice
                </a>
              </p>
            ) : null}
            <h3>Technician note</h3>
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                setWorking(true);
                setMessage("");
                const response = await fetch(`/api/jobs/${selected.id}/complete`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ techNote: note }),
                });
                const body = (await response.json()) as { error?: string; job?: Job };
                setWorking(false);
                if (!response.ok || !body.job) {
                  setMessage(body.error || "Could not invoice the job.");
                  return;
                }
                setMessage(`Invoice ${body.job.invoiceId ?? ""} sent via ${body.job.invoiceVia ?? "PayPal"}.`);
                await refresh();
              }}
            >
              <label htmlFor="tech-note">What did the tech do?</label>
              <textarea id="tech-note" rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
              <button className="primary" type="submit" disabled={working || selected.status === "cancelled" || selected.status === "paid"}>
                {working ? "Building invoice…" : "Mark complete and invoice"}
              </button>
            </form>
            {message ? <p role="status">{message}</p> : null}
          </article>
          <article className="panel">
            <h2 style={{ marginTop: 0 }}>Transcript</h2>
            <div className="transcript">
              {selected.transcript.length === 0 ? <p className="muted">No chat saved for this job.</p> : null}
              {selected.transcript.map((entry, index) => (
                <p key={`${entry.at}-${index}`} className={`bubble ${entry.role}`}>
                  {entry.text}
                </p>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
