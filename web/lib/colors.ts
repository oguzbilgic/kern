const AVATAR_COLORS = ["#e06c75", "#e5c07b", "#98c379", "#56b6c2", "#61afef", "#c678dd", "#be5046", "#d19a66"];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
