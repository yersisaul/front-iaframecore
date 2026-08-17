import * as XLSX from 'xlsx';

export interface ExportColumn {
  header: string;
  key: string;
}

export function exportToCsv(filename: string, columns: ExportColumn[], data: any[]): void {
  const headers = columns.map(c => `"${String(c.header).replace(/"/g, '""')}"`).join(',');
  const rows = data.map(row => {
    return columns.map(col => {
      let val = row[col.key];
      if (val === null || val === undefined) val = '';
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
  });

  const csvContent = '\uFEFF' + [headers, ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function exportToXlsx(filename: string, sheetName: string, columns: ExportColumn[], data: any[]): void {
  const formattedData = data.map(row => {
    const rowObj: Record<string, any> = {};
    columns.forEach(col => {
      let val = row[col.key];
      if (val === null || val === undefined) val = '';
      rowObj[col.header] = val;
    });
    return rowObj;
  });

  const worksheet = XLSX.utils.json_to_sheet(formattedData, {
    header: columns.map(c => c.header)
  });

  // Auto-ajustar ancho de columnas de forma inteligente
  const colWidths = columns.map(col => {
    let maxLen = col.header.length;
    formattedData.forEach(row => {
      const valStr = String(row[col.header] || '');
      if (valStr.length > maxLen) {
        maxLen = valStr.length;
      }
    });
    return { wch: Math.min(Math.max(maxLen + 3, 12), 60) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || 'Reporte');

  const finalName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, finalName);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
