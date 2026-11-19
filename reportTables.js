import { escapeHtml as e } from './html.js';

// Cell markup is supplied by the caller, which escapes any external values.
export function reportTable(columns, rows, { caption = '', comparison = false } = {}) {
  const headings = columns.map(column => `<th scope="col" role="columnheader">${e(column)}</th>`).join('');
  const body = rows.map(([heading, ...values]) => `<tr role="row"><th scope="row" role="rowheader">${heading}</th>${values.map((value, index) =>
    `<td role="cell"><span class="report-cell-label" aria-hidden="true">${e(columns[index + 1])}</span><div class="report-cell-value">${value}</div></td>`).join('')}</tr>`).join('');
  return `<div class="report-table-wrap report-table-wrap--responsive"><table class="report-table report-table--responsive${comparison ? ' report-table--comparison' : ''}" role="table" style="--data-columns:${Math.min(3, columns.length - 1)}">
    ${caption ? `<caption${comparison ? '' : ' class="sr-only"'}>${e(caption)}</caption>` : ''}
    <thead role="rowgroup"><tr role="row">${headings}</tr></thead><tbody role="rowgroup">${body}</tbody>
  </table></div>`;
}
