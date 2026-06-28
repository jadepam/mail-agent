/** RFC 5322 需要用引号包裹的特殊字符 */
const RFC5322_SPECIAL = /[\(\)<>[\]:;@\\,."]/

/**
 * 格式化邮件地址为 RFC 5322 规范格式
 *
 * - 有名且不含特殊字符：`Name <addr>`
 * - 有名且含特殊字符：`"Name" <addr>`（引号内双引号转义）
 * - 无名：`addr`
 */
export function formatMailAddress(name: string | undefined, address: string): string {
  if (!name) return address
  if (RFC5322_SPECIAL.test(name)) {
    return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${address}>`
  }
  return `${name} <${address}>`
}
