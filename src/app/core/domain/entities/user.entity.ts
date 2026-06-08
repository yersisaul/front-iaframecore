export interface User {
  id: string;
  username: string;
  name: string | null;
  role: string;
  createdAt: Date;
}
