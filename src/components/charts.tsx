/**
 * Minimal, accessible single-series charts. One validated hue (--color-chart), values in
 * ink text beside every bar (identity never relies on colour) and a native tooltip on each mark.
 */
export function BarList({ data, format = (n: number) => String(n), label }: { data: { label: string; value: number }[]; format?: (n: number) => string; label: string }) {
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted">No data for this period.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <table className="w-full text-sm" aria-label={label}>
      <tbody>
        {data.map((d) => (
          <tr key={d.label} title={`${d.label}: ${format(d.value)}`} className="group">
            <th scope="row" className="w-40 py-1.5 pr-3 text-left font-normal text-ink-soft">
              <span className="line-clamp-1">{d.label}</span>
            </th>
            <td className="py-1.5">
              <div className="h-3 w-full">
                <div className="h-3 rounded-r-[4px] bg-chart transition-opacity group-hover:opacity-80" style={{ width: `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%` }} />
              </div>
            </td>
            <td className="w-16 py-1.5 pl-3 text-right tabular-nums text-ink">{format(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DailyColumns({ data, label }: { data: { day: string; count: number }[]; label: string }) {
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted">No enquiries in this period.</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <figure>
      <div className="flex h-36 items-end gap-[2px] border-b border-line" aria-hidden>
        {data.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}: ${d.count} enquir${d.count === 1 ? "y" : "ies"}`}>
            <div className="w-full rounded-t-[4px] bg-chart group-hover:opacity-80" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted" aria-hidden>
        <span>{data[0].day}</span>
        <span>Peak {max}/day</span>
        <span>{data[data.length - 1].day}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
