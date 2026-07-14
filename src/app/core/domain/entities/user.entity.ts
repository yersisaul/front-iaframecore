export interface User {
  id: string;
  email: string;
  name: string | null;
  firstName?: string;
  lastName?: string;
  role: string;
  createdAt: Date;
  password?: string;
  roleId?: string;
}
