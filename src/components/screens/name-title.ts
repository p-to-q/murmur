export type NameTitleMode = "suggested" | "custom";

export type NameTitleState = {
  title: string;
  titleMode: NameTitleMode;
};

export function getInitialNameTitleState(
  versionTitle: string | undefined,
  suggestions: string[],
): NameTitleState {
  const trimmedVersionTitle = versionTitle?.trim();
  if (trimmedVersionTitle) {
    return { title: trimmedVersionTitle, titleMode: "custom" };
  }

  return { title: suggestions[0] ?? "", titleMode: "suggested" };
}

export function resolveNameDisplayTitle(
  state: NameTitleState,
  suggestions: string[],
): string {
  if (state.titleMode === "custom") {
    return state.title;
  }

  return suggestions.includes(state.title)
    ? state.title
    : suggestions[0] ?? state.title;
}
