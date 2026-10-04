import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';

export const useInputFocusRing = () => {
  const { theme } = useThemeContext();
  return getInputFocusRing(theme);
};

/** The same AionUI focus treatment for hosts that manage appearance independently. */
export const getInputFocusRing = (theme: string) => {
  const isDarkTheme = theme === 'dark';

  return {
    activeBorderColor: isDarkTheme ? '#4D4B87' : '#E1E0FF',
    inactiveBorderColor: isDarkTheme ? '#3a3a4a' : '#c9cacf',
    activeShadow: isDarkTheme ? '0px 2px 20px rgba(77, 75, 135, 0.45)' : '0px 2px 20px rgba(225, 224, 255, 0.6)',
  };
};
