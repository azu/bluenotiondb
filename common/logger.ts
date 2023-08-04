export const log = (message?: any, ...optionalParams: any[]) => {
    console.log(message, ...optionalParams);
}
export const errorLog = (message?: any, ...optionalParams: any[]) => {
    console.error(message, ...optionalParams);
}
export const debug = (message?: any, ...optionalParams: any[]) => {
    if (process.env.DEBUG === undefined) {
        return;
    }
    console.log("[DEBUG]", message, ...optionalParams);
}

export const createLogger = (name: string) => {
    return {
        log: (message?: any, ...optionalParams: any[]) => {
            console.log(`[${name}]`, message, ...optionalParams);
        },
        error: (message?: any, ...optionalParams: any[]) => {
            console.error(`[${name}]`, message, ...optionalParams);
        },
        debug: (message?: any, ...optionalParams: any[]) => {
            if (process.env.DEBUG === undefined) {
                return;
            }
            console.log(`[${name}]`, "[DEBUG]", message, ...optionalParams);
        }
    }
}
