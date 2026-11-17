// Русский и узбекский (латиница) с первого дня — требование спецификации MVP.
export type Lang = "ru" | "uz";

const ru = {
  tagline: "Приёмка работ с фотофиксацией",
  phoneLabel: "Номер телефона",
  getCode: "Получить код",
  codeSentTo: "Код отправлен на",
  codeLabel: "Код из SMS",
  signIn: "Войти",
  changePhone: "Другой номер",
  resend: "Отправить код ещё раз",
  loading: "Загрузка…",
  hello: "Здравствуйте",
  roleOwner: "Руководитель",
  roleForeman: "Прораб",
  company: "Компания",
  telegram: "Telegram",
  linked: "привязан",
  notLinked: "не привязан",
  logout: "Выйти",
  attemptsLeft: "Осталось попыток",
  wrongPhone: "Введите номер в формате +998 XX XXX XX XX",
  errors: {
    INVALID_CODE: "Неверный или просроченный код",
    RATE_LIMITED: "Слишком много попыток. Подождите и запросите новый код",
    VALIDATION_ERROR: "Проверьте введённые данные",
  } as Record<string, string>,
};

const uz: typeof ru = {
  tagline: "Ishlarni foto bilan qabul qilish",
  phoneLabel: "Telefon raqami",
  getCode: "Kod olish",
  codeSentTo: "Kod yuborildi:",
  codeLabel: "SMS-dagi kod",
  signIn: "Kirish",
  changePhone: "Boshqa raqam",
  resend: "Kodni qayta yuborish",
  loading: "Yuklanmoqda…",
  hello: "Assalomu alaykum",
  roleOwner: "Rahbar",
  roleForeman: "Prorab",
  company: "Kompaniya",
  telegram: "Telegram",
  linked: "ulangan",
  notLinked: "ulanmagan",
  logout: "Chiqish",
  attemptsLeft: "Qolgan urinishlar",
  wrongPhone: "Raqamni +998 XX XXX XX XX ko'rinishida kiriting",
  errors: {
    INVALID_CODE: "Kod noto'g'ri yoki muddati o'tgan",
    RATE_LIMITED: "Urinishlar juda ko'p. Biroz kuting va yangi kod so'rang",
    VALIDATION_ERROR: "Kiritilgan ma'lumotlarni tekshiring",
  },
};

export const dict = { ru, uz };
export type Dict = typeof ru;
