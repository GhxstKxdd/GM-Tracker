export type UserRole = 'general-manager' | 'department-manager' | 'read-only'
export type Permission = 'performance:read' | 'performance:write' | 'actions:manage' | 'users:manage'

export interface AuthenticatedUser {
  id: string
  displayName: string
  email: string
  role: UserRole
}

export interface AuthenticationProvider {
  currentUser(): Promise<AuthenticatedUser | null>
  signIn(email: string, password: string): Promise<AuthenticatedUser>
  signOut(): Promise<void>
}

export interface PermissionPolicy {
  can(user: AuthenticatedUser, permission: Permission): boolean
}

// Interfaces only: this local prototype does not create accounts or imply shared access.
