import mammoth from "mammoth";
import { jsPDF } from "jspdf";

export async function convertWordToPdfBlob(file: File): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Use Mammoth to convert DOCX to HTML
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
  
  // Create a temporary container for the HTML
  const container = document.createElement("div");
  container.style.width = "794px"; // A4 width at 96dpi roughly
  container.style.padding = "40px"; // Margins
  container.style.backgroundColor = "white";
  container.style.color = "black";
  container.style.fontFamily = "sans-serif";
  container.style.fontSize = "14px";
  container.style.position = "absolute";
  container.style.top = "-9999px";
  container.style.left = "-9999px";
  container.innerHTML = html;
  
  document.body.appendChild(container);
  
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  
  return new Promise((resolve, reject) => {
    pdf.html(container, {
      callback: (doc) => {
        document.body.removeChild(container);
        const blob = doc.output("blob");
        resolve(blob);
      },
      x: 0,
      y: 0,
      width: 210,
      windowWidth: 794
    }).catch((err: Error) => {
      document.body.removeChild(container);
      reject(err);
    });
  });
}
