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
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<?mso-application progid="Excel.Sheet"?>\n`;
  xml += `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n`;
  xml += ` xmlns:o="urn:schemas-microsoft-com:office:office"\n`;
  xml += ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n`;
  xml += ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n`;
  xml += ` <Styles>\n`;
  xml += `  <Style ss:ID="Header">\n`;
  xml += `   <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="11"/>\n`;
  xml += `   <Interior ss:Color="#065F46" ss:Pattern="Solid"/>\n`;
  xml += `   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>\n`;
  xml += `  </Style>\n`;
  xml += `  <Style ss:ID="Cell">\n`;
  xml += `   <Alignment ss:Vertical="Center"/>\n`;
  xml += `  </Style>\n`;
  xml += ` </Styles>\n`;
  xml += ` <Worksheet ss:Name="${escapeXml(sheetName)}">\n`;
  xml += `  <Table>\n`;

  // Header Row
  xml += `   <Row ss:Height="26">\n`;
  columns.forEach(col => {
    xml += `    <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>\n`;
  });
  xml += `   </Row>\n`;

  // Data Rows
  data.forEach(row => {
    xml += `   <Row ss:Height="22">\n`;
    columns.forEach(col => {
      let val = row[col.key];
      if (val === null || val === undefined) val = '';
      xml += `    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(String(val))}</Data></Cell>\n`;
    });
    xml += `   </Row>\n`;
  });

  xml += `  </Table>\n`;
  xml += ` </Worksheet>\n`;
  xml += `</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const finalName = filename.endsWith('.xlsx') || filename.endsWith('.xls') ? filename : `${filename}.xlsx`;
  downloadBlob(blob, finalName);
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
