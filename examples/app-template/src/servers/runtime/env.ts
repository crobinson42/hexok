export function requiredEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function load(name: string): Promise<unknown> {
  return import(name);
}
