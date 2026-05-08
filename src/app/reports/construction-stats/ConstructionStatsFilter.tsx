"use client";

import Link from "next/link";
import { useState } from "react";

interface Props {
  mechanic?: string;
  search?: string;
  allMechanics: string[];
}

export function ConstructionStatsFilter({ mechanic, search, allMechanics }: Props) {
  const [searchValue, setSearchValue] = useState(search || "");

  return (
    <form className="flex flex-wrap items-center gap-3">
      <select
        name="mechanic"
        defaultValue={mechanic || ""}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        onChange={(e) => e.currentTarget.form?.submit()}
      >
        <option value="">全部施工人</option>
        {allMechanics.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
      <input
        type="text"
        name="search"
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        placeholder="搜索项目或车型"
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-48"
      />
      <button
        type="submit"
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        筛选
      </button>
      {(mechanic || search) && (
        <Link
          href="/reports/construction-stats"
          className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          重置
        </Link>
      )}
    </form>
  );
}
