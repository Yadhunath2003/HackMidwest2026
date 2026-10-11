import type { AIReport } from "@/lib/types";

export default function AIReportView({ report }: { report: AIReport }) {
  return <div className="notice">
    <h3>AI analysis</h3>
    <p>{report.summary}</p>
    {([
      ["Findings", report.findings], ["Limitations", report.limitations], ["Experiments to test next", report.next_tests],
    ] as [string, string[]][]).map(([label, items]) => items.length > 0 && <div key={label}>
      <h3>{label}</h3><ul className="plain">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </div>)}
    <p className="muted">AI interpretation of recorded results. Historical simulation, not a prediction. <span className="tag">{report.source}</span></p>
  </div>;
}
