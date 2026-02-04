
import { DocumentPage, GroupedDocument, ProcessingProgress, BallotData, ApiSettings } from "../types";
import { AIService } from "./ai";
import { PDFProcessor } from "./pdf";

export class DocumentController {
  private ai = new AIService();

  async processFiles(
    files: File[], 
    settings: ApiSettings,
    onProgress: (p: ProcessingProgress) => void,
    onLog: (msg: string) => void
  ): Promise<GroupedDocument[]> {
    onLog("🎬 Начало глубокого анализа документов...");
    
    let allPages: DocumentPage[] = [];
    for (const file of files) {
      const pages = await PDFProcessor.extractPages(file);
      allPages = [...allPages, ...pages];
    }

    const results: GroupedDocument[] = [];
    let lastActiveDoc: GroupedDocument | null = null;

    for (let i = 0; i < allPages.length; i++) {
      const page = allPages[i];
      onProgress({ current: i + 1, total: allPages.length, status: `Распознавание страницы ${i + 1}...` });

      const analysis = await this.ai.analyzePage(page, settings);
      const d = analysis.data;
      
      let targetDoc = results.find(doc => {
        if (d.snils && doc.data.snils && d.snils === doc.data.snils) return true;
        const currentFullName = `${d.lastName || ''} ${d.firstName || ''} ${d.middleName || ''}`.trim();
        const docFullName = `${doc.data.lastName || ''} ${doc.data.firstName || ''} ${doc.data.middleName || ''}`.trim();
        if (currentFullName && docFullName && currentFullName === docFullName) return true;
        return false;
      });

      if (analysis.isStartPage || (!targetDoc && !lastActiveDoc)) {
        const name = d.lastName ? `${d.lastName} ${d.firstName?.charAt(0) || ''}.${d.middleName?.charAt(0) || ''}.` : `Документ ${results.length + 1}`;
        
        const newDoc: GroupedDocument = {
          id: `doc-${Date.now()}-${results.length}-${Math.random().toString(36).substr(2, 5)}`,
          name: name,
          snils: d.snils,
          pages: [page],
          data: d,
          isVerified: false
        };
        results.push(newDoc);
        lastActiveDoc = newDoc;
        onLog(`✅ ${analysis.isStartPage ? 'Начало документа' : 'Распознана личность'}: ${name}`);
      } else {
        const docToUpdate = targetDoc || lastActiveDoc;
        if (docToUpdate) {
          docToUpdate.pages.push(page);
          this.mergeData(docToUpdate.data, d);
          if (!docToUpdate.data.lastName && d.lastName) {
             docToUpdate.name = `${d.lastName} ${d.firstName?.charAt(0) || ''}.${d.middleName?.charAt(0) || ''}.`;
          }
        }
      }
    }

    onLog(`🏁 Обработка завершена. Найдено документов: ${results.length}`);
    return results;
  }

  private mergeData(target: Partial<BallotData>, source: Partial<BallotData>) {
    const fields: (keyof BallotData)[] = ['address', 'lastName', 'firstName', 'middleName', 'snils', 'roomNo', 'area', 'ownershipShare', 'regNumber', 'regDate', 'meetingDate'];
    fields.forEach(f => {
      if (!target[f] || (target[f] === 'ОШИБКА' && source[f] && source[f] !== 'ОШИБКА')) {
        target[f] = source[f] as any;
      }
    });

    if (source.votes) {
      target.votes = { ...(target.votes || {}), ...source.votes };
    }
    if (source.questionTexts) {
      const existing = target.questionTexts || {};
      for (const [q, text] of Object.entries(source.questionTexts)) {
        if (text && (!existing[q] || text.length > existing[q].length)) {
          existing[q] = text;
        }
      }
      target.questionTexts = existing;
    }
  }
}
