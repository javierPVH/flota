export const customEmailList = (value: string) => value.split(/[,;\s]+/).filter(Boolean)
export const invalidCorporateEmails = (value: string, domains: string[]) =>
  customEmailList(value).some(address => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !domains.includes(address.split('@')[1].toLowerCase()))
