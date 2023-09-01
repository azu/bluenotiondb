import { beforeAll, expect, setSystemTime, test } from "bun:test";
import { parserFunction } from "./github_search.js";

const testDate = new Date("2020-01-01T00:00:00.000Z");
const testTable = [
    {
        input: "test test",
        output: "test test"
    },
    {
        input: "test created:2020-01-01",
        output: "test created:2020-01-01"
    },
    {
        input: "test created:{{today}}",
        output: "test created:2020-01-01"
    },
    // + pattern
    {
        input: "test created:>{{+1day}}",
        output: "test created:>2020-01-02"
    },
    {
        input: "test created:>{{+1month}}",
        output: "test created:>2020-02-01"
    },
    {
        input: "test created:>{{+1year}}",
        output: "test created:>2021-01-01"
    },
    // multiple
    {
        input: "test created:>{{+1day}}...<{{+1month}}",
        output: "test created:>2020-01-02...<2020-02-01"
    },
    // - pattern
    {
        input: "test created:<{{-1day}}",
        output: "test created:<2019-12-31"
    },
    {
        input: "test created:>{{-1month}}",
        output: "test created:>2019-12-01"
    },
    {
        input: "test created:>{{-1year}}",
        output: "test created:>2019-01-01"
    },
    // multiple
    {
        input: "test created:>{{-1day}}...<{{-1month}}",
        output: "test created:>2019-12-31...<2019-12-01"
    },
    // + and - pattern
    {
        input: "test created:>{{+1day}}...<{{-1month}}",
        output: "test created:>2020-01-02...<2019-12-01"
    }
];
beforeAll(() => {
    setSystemTime(testDate);
});

testTable.forEach(({ input, output }) => {
    test(`parserFunction: ${input} -> ${output}`, () => {
        expect(parserFunction(input)).toEqual(output);
    });
});
