import md5 from 'md5'

export function getGravatarUrl(email: string) {
  const emailHash = md5(String(email ?? '').toLowerCase().trim())
  return `https://www.gravatar.com/avatar/${emailHash}`
}