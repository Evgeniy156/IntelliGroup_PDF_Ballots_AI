
import { GoogleGenAI, Type } from "@google/genai";
import { DocumentPage } from "../types";

export class AIService {
  private ai: GoogleGenAI;

  constructor() {
    // Fix: Updated to follow Google GenAI SDK guidelines for API key initialization and direct usage
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }

  async analyzePage(page: DocumentPage): Promise<{ isStartPage: boolean; name: string; snils: string }> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            parts: [
              { inlineData: { data: page.imageData.split(',')[1], mimeType: 'image/jpeg' } },
              { text: `Проанализируй эту страницу документа (бюллетень ЖКХ). 
              Определи:
              1. Является ли это ПЕРВОЙ страницей (содержит поля ФИО, СНИЛС, Адрес)?
              2. Если да, извлеки ФИО и СНИЛС (если они заполнены).
              Ответь строго в формате JSON: 
              {"isStartPage": boolean, "name": "Фамилия И.О.", "snils": "номер"}
              Если это не первая страница, name и snils оставь пустыми.` }
            ]
          }
        ],
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isStartPage: { type: Type.BOOLEAN },
              name: { type: Type.STRING },
              snils: { type: Type.STRING }
            },
            required: ["isStartPage"]
          }
        }
      });

      const text = response.text || '{}';
      return JSON.parse(text);
    } catch (error) {
      console.error("AI Analysis Error:", error);
      return { isStartPage: false, name: '', snils: '' };
    }
  }
}
