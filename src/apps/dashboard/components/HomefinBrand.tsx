import React, { type FC } from 'react';
import { Link } from 'react-router-dom';

import { BRAND_NAME } from 'homefin/accounts/components';

/** The Home Fin wordmark in the admin bar: back to Home, with a quiet "Admin" label. */
const HomefinBrand: FC = () => (
    <Link to='/home' className='hfDashBrand' aria-label={`${BRAND_NAME}: back to Home`}>
        <span className='hfDashBrand-word' aria-hidden='true'>{BRAND_NAME}</span>
        <span className='hfDashBrand-tag'>Admin</span>
    </Link>
);

export default HomefinBrand;
