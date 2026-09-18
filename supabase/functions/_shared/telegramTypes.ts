export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
  location?: { latitude: number; longitude: number };
  contact?: { phone_number: string; first_name: string; user_id?: number };
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string; username?: string };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
}
