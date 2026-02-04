
import { GoogleGenAI, Type } from "@google/genai";
import { DocumentPage, BallotData, ApiSettings } from "../types";

export class AIService {
  async analyzePage(page: DocumentPage, settings: ApiSettings): Promise<{ isStartPage: boolean; data: Partial<BallotData> }> {
    const prompt = `Ты — эксперт по OCR бюллетеней ЖКХ. 
              Твоя задача — извлечь данные и определить, является ли страница НАЧАЛОМ нового документа.
              
              ПРИЗНАКИ НАЧАЛЬНОЙ СТРАНИЦЫ (isStartPage: true):
              - Наличие заголовка "РЕШЕНИЕ СОБСТВЕННИКА" или "БЮЛЛЕТЕНЬ".
              - Наличие полей для ФИО и СНИЛС (обычно пустых или заполненных от руки в верхней половине).
              - Наличие адресной информации МКД.
              
              ПРИЗНАКИ ПОСЛЕДУЮЩЕЙ СТРАНИЦЫ (isStartPage: false):
              - Только таблица с вопросами (продолжение).
              - Отсутствие шапки с ФИО/СНИЛС.
              - Подписи в самом низу страницы.

              ДАННЫЕ ДЛЯ ИЗВЛЕЧЕНИЯ:
              - ФИО (Фамилия, Имя, Отчество).
              - СНИЛС (11 цифр).
              - Тексты вопросов (колонка "Наименование вопроса"). Извлекай ПОЛНОСТЬЮ.
              - Результаты (ЗА, ПРОТИВ, ВОЗДЕРЖАЛСЯ).
              
              ВАЖНО: 
              1. Если текста вопроса нет или он не на этой странице, верни пустую строку "". НИКОГДА не используй слово "null".
              2. Если поле неразборчиво, пиши "ОШИБКА".
              3. СНИЛС и ФИО крайне важны для объединения страниц.
              
              Формат строго JSON.`;

    if (settings.provider === 'openrouter') {
      return this.analyzeWithOpenRouter(page.imageData, prompt, settings);
    }

    // Google Provider: Create instance right before call as per guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
    try {
      const response = await ai.models.generateContent({
        model: settings.model || 'gemini-3-flash-preview',
        contents: [
          {
            parts: [
              { inlineData: { data: page.imageData.split(',')[1], mimeType: 'image/jpeg' } },
              { text: prompt }
            ]
          }
        ],
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isStartPage: { type: Type.BOOLEAN },
              data: {
                type: Type.OBJECT,
                properties: {
                  address: { type: Type.STRING },
                  lastName: { type: Type.STRING },
                  firstName: { type: Type.STRING },
                  middleName: { type: Type.STRING },
                  snils: { type: Type.STRING },
                  roomNo: { type: Type.STRING },
                  area: { type: Type.STRING },
                  ownershipShare: { type: Type.STRING },
                  regNumber: { type: Type.STRING },
                  regDate: { type: Type.STRING },
                  meetingDate: { type: Type.STRING },
                  questionTexts: {
                    type: Type.OBJECT,
                    properties: {
                      "1": { type: Type.STRING },
                      "2": { type: Type.STRING },
                      "3": { type: Type.STRING },
                      "4": { type: Type.STRING }
                    }
                  },
                  votes: { 
                    type: Type.OBJECT,
                    properties: {
                      "1": { type: Type.STRING },
                      "2": { type: Type.STRING },
                      "3": { type: Type.STRING },
                      "4": { type: Type.STRING }
                    }
                  }
                }
              }
            },
            required: ["isStartPage"]
          }
        }
      });

      const res = JSON.parse(response.text || '{}');
      return {
        isStartPage: res.isStartPage || false,
        data: res.data || {}
      };
    } catch (error: any) {
      console.error("AI Error:", error);
      // Handle the key selection race or missing entity error
      if (error.message?.includes("Requested entity was not found")) {
        throw new Error("API_KEY_EXPIRED");
      }
      return { isStartPage: false, data: {} };
    }
  }

  private async analyzeWithOpenRouter(imageData: string, prompt: string, settings: ApiSettings) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.origin,
          "X-Title": "IntelliGroup Desktop"
        },
        body: JSON.stringify({
          "model": settings.model || "google/gemini-3-pro-preview",
          "messages": [
            {
              "role": "user",
              "content": [
                { "type": "text", "text": prompt },
                {
                  "type": "image_url",
                  "image_url": {
                    "url": imageData
                  }
                }
              ]
            }
          ],
          "response_format": { "type": "json_object" }
        })
      });

      const json = await response.json();
      if (json.error) throw new Error(json.error.message);

      const res = JSON.parse(json.choices[0].message.content || '{}');
      return {
        isStartPage: res.isStartPage || false,
        data: res.data || {}
      };
    } catch (error) {
      console.error("OpenRouter Error:", error);
      return { isStartPage: false, data: {} };
    }
  }
}
