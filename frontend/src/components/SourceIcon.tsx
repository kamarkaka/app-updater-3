import { VscGithub } from "react-icons/vsc";
import { SiGitlab } from "react-icons/si";
import { HiOutlineGlobeAlt } from "react-icons/hi2";

export default function SourceIcon({ sourceType }: { sourceType: string }) {
  const base = "w-3.5 h-3.5 shrink-0";

  switch (sourceType) {
    case "github":
      return <VscGithub className={`${base} text-gray-400`} />;
    case "gitlab":
      return <SiGitlab className={`${base} text-orange-400`} />;
    default:
      return <HiOutlineGlobeAlt className={`${base} text-gray-500`} />;
  }
}
