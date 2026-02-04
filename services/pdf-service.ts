
import { DocumentPage, GroupedDocument } from "../types";

// @ts-ignore
const pdfjsLib = window.pdfjsLib;
// @ts-ignore
const { jsPDF } = window.jspdf;

export class PDFService {
  static async extractPages(file: File): Promise<DocumentPage[]> {
    const pages: DocumentPage[] = [];
    
    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({ canvasContext: context, viewport }).promise;
        const imageData = canvas.toDataURL('image/jpeg', 0.7);
        
        // QR Scanning
        const rawData = context.getImageData(0, 0, canvas.width, canvas.height);
        // @ts-ignore
        const qr = window.jsQR(rawData.data, rawData.width, rawData.height);
        
        // Fix: Added missing rotation property and included qrData/isStartPage
        pages.push({
          id: `${file.name}-${i}-${Math.random()}`,
          sourceFile: file.name,
          pageNumber: i,
          imageData,
          rotation: 0,
          qrData: qr?.data,
          isStartPage: false
        });
      }
    } else {
      const imageData = await this.fileToDataUrl(file);
      // Fix: Added missing rotation property and included isStartPage
      pages.push({
        id: `${file.name}-${Math.random()}`,
        sourceFile: file.name,
        pageNumber: 1,
        imageData,
        rotation: 0,
        isStartPage: false
      });
    }
    return pages;
  }

  static async generatePDF(doc: GroupedDocument) {
    const pdf = new jsPDF();
    for (let i = 0; i < doc.pages.length; i++) {
      if (i > 0) pdf.addPage();
      const page = doc.pages[i];
      const imgProps = pdf.getImageProperties(page.imageData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(page.imageData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    }
    pdf.save(`${doc.name.replace(/[^a-zа-я0-9]/gi, '_')}.pdf`);
  }

  private static fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
  }
}
