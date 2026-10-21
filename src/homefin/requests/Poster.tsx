import React, { type FC, useCallback, useState } from 'react';

/** A remote poster (TMDB / TVDB) that quietly gives way to `fallback` if it can't load. */
const Poster: FC<{ src: string | null, className?: string, fallback?: React.ReactElement | null }> = ({ src, className, fallback = null }) => {
    const [failed, setFailed] = useState(false);
    const onError = useCallback(() => setFailed(true), []);
    if (!src || failed) return fallback;
    return <img className={className} src={src} alt='' loading='lazy' onError={onError} />;
};

export default Poster;
