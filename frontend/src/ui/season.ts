import { useEffect, useState } from "react";
import "./season.css";

export const MONTHS = [
  { name: "Январь", mood: "Морозное утро", hue: 207, accent: "#306382", glow: "#dfedf8", paper: "#f5f8fc", mark: "❄" },
  { name: "Февраль", mood: "Тёплый свет", hue: 326, accent: "#91466b", glow: "#f4e3ed", paper: "#fbf6f9", mark: "✧" },
  { name: "Март", mood: "Первая зелень", hue: 151, accent: "#34745a", glow: "#deeee3", paper: "#f5f9f6", mark: "❧" },
  { name: "Апрель", mood: "После дождя", hue: 189, accent: "#306d79", glow: "#dfedef", paper: "#f4f9fa", mark: "◌" },
  { name: "Май", mood: "Время цвести", hue: 274, accent: "#73518a", glow: "#eee3f3", paper: "#faf7fb", mark: "✿" },
  { name: "Июнь", mood: "Длинные дни", hue: 163, accent: "#28705f", glow: "#dcefe7", paper: "#f4faf7", mark: "☀" },
  { name: "Июль", mood: "В зените лета", hue: 36, accent: "#876019", glow: "#f7ebce", paper: "#fcfaf4", mark: "☀" },
  { name: "Август", mood: "Медовый вечер", hue: 28, accent: "#946032", glow: "#f4e4ce", paper: "#fcf8f2", mark: "❧" },
  { name: "Сентябрь", mood: "Золотые листья", hue: 22, accent: "#93583a", glow: "#f2e2d4", paper: "#faf7f2", mark: "❧" },
  { name: "Октябрь", mood: "Пряная осень", hue: 15, accent: "#a05239", glow: "#f3ded3", paper: "#fbf6f2", mark: "❧" },
  { name: "Ноябрь", mood: "Тихий туман", hue: 244, accent: "#625c80", glow: "#e6e4ee", paper: "#f7f7fa", mark: "≋" },
  { name: "Декабрь", mood: "Огоньки зимы", hue: 166, accent: "#346d60", glow: "#deebe5", paper: "#f5f9f7", mark: "✦" }
] as const;

export function useSeason() {
  const [month, setMonth] = useState(() => new Date().getMonth());
  useEffect(() => {
    const update = () => setMonth(new Date().getMonth());
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const theme = MONTHS[month];
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.month = String(month + 1);
    root.style.setProperty("--season-hue", String(theme.hue));
    root.style.setProperty("--season-accent", theme.accent);
    root.style.setProperty("--season-glow", theme.glow);
    root.style.setProperty("--season-paper", theme.paper);
  }, [month, theme]);
  return theme;
}
