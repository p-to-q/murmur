"use client";

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  active?: boolean;
};

function baseProps({ active, ...rest }: IconProps) {
  void active;
  return rest;
}

export function CreateNavIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...baseProps(props)}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <circle
        cx="12"
        cy="12"
        r={props.active ? "6.35" : "6.05"}
        stroke="currentColor"
        strokeWidth={props.active ? "1.9" : "1.7"}
      />
      <circle
        cx="12"
        cy="12"
        r={props.active ? "1.85" : "1.65"}
        fill="currentColor"
      />
    </svg>
  );
}

export function StudioNavIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...baseProps(props)}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 6h10" stroke="currentColor" strokeWidth={props.active ? "1.9" : "1.7"} strokeLinecap="round" />
      <path d="M14 12h6" stroke="currentColor" strokeWidth={props.active ? "1.9" : "1.7"} strokeLinecap="round" />
      <path d="M4 18h16" stroke="currentColor" strokeWidth={props.active ? "1.9" : "1.7"} strokeLinecap="round" />
      <circle cx="16" cy="6" r="2.2" stroke="currentColor" strokeWidth={props.active ? "1.9" : "1.7"} />
      <circle cx="8" cy="12" r="2.2" stroke="currentColor" strokeWidth={props.active ? "1.9" : "1.7"} />
      <circle cx="14" cy="18" r="2.2" stroke="currentColor" strokeWidth={props.active ? "1.9" : "1.7"} />
    </svg>
  );
}

export function VibeNavIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...baseProps(props)}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path
        d="M12 3.8L13.95 8.05L18.2 10L13.95 11.95L12 16.2L10.05 11.95L5.8 10L10.05 8.05L12 3.8Z"
        stroke="currentColor"
        strokeWidth={props.active ? "1.9" : "1.7"}
        strokeLinejoin="round"
      />
      <path d="M18.1 15.6L18.7 17.05L20.15 17.65L18.7 18.25L18.1 19.7L17.5 18.25L16.05 17.65L17.5 17.05L18.1 15.6Z" fill="currentColor" />
    </svg>
  );
}

export function GalleryNavIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...baseProps(props)}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <rect
        x="4.5"
        y="4.5"
        width="15"
        height="15"
        rx="3.05"
        stroke="currentColor"
        strokeWidth={props.active ? "1.9" : "1.7"}
      />
      <path d="M10 8v8" stroke="currentColor" strokeWidth={props.active ? "1.7" : "1.5"} strokeLinecap="round" />
      <path d="M14 8v8" stroke="currentColor" strokeWidth={props.active ? "1.7" : "1.5"} strokeLinecap="round" />
      <path d="M8 10h8" stroke="currentColor" strokeWidth={props.active ? "1.7" : "1.5"} strokeLinecap="round" />
      <path d="M8 14h8" stroke="currentColor" strokeWidth={props.active ? "1.7" : "1.5"} strokeLinecap="round" />
    </svg>
  );
}

export function MeNavIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...baseProps(props)}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <circle
        cx="12"
        cy="12"
        r="8"
        stroke="currentColor"
        strokeWidth={props.active ? "1.9" : "1.7"}
      />
      <circle
        cx="12"
        cy="9"
        r="2.6"
        stroke="currentColor"
        strokeWidth={props.active ? "1.9" : "1.7"}
      />
      <path
        d="M8.1 16.6C9.05 15.12 10.34 14.38 12 14.38C13.66 14.38 14.95 15.12 15.9 16.6"
        stroke="currentColor"
        strokeWidth={props.active ? "1.9" : "1.7"}
        strokeLinecap="round"
      />
    </svg>
  );
}
